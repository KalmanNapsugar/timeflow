import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  addZonedDays, dayRangesFromWeekly, getZonedParts,
  resolveBusinessTz, zonedStartOfDay,
} from "@/lib/timezone";


const DayPatternValue = z.union([
  z.tuple([z.string(), z.string()]),
  z.array(z.tuple([z.string(), z.string()])),
  z.null(),
]);
const WeeklyDays = z.record(
  z.enum(["mon","tue","wed","thu","fri","sat","sun"]),
  DayPatternValue,
);
const WorkingHours = z.union([
  WeeklyDays,
  z.object({
    mode: z.literal("alternating"),
    alt: z.object({ even: WeeklyDays.nullable().optional(), odd: WeeklyDays.nullable().optional() }),
  }),
  z.object({}).passthrough(),
]).optional();

const UpsertInput = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  staffProfileId: z.string().uuid(),
  resourceId: z.string().uuid(),
  kind: z.enum(["always", "scheduled"]),
  workingHours: WorkingHours,
  windows: z.array(z.object({ start: z.string(), end: z.string() })).default([]),
  active: z.boolean().default(true),
});

const EXCLUSIVE_TYPES = new Set(["room", "chair"]);
const DAY_KEYS = ["mon","tue","wed","thu","fri","sat","sun"] as const;

type AnyAssign = {
  id?: string;
  kind: string;
  working_hours_json: any;
  availability_windows_json: any[] | null;
};

function timeRangeOverlap(a: [string, string], b: [string, string]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}
function extractAllWeeklySlots(wh: any): Record<string, [string,string][]> {
  const out: Record<string, [string,string][]> = { mon:[], tue:[], wed:[], thu:[], fri:[], sat:[], sun:[] };
  if (!wh) return out;
  const consume = (pat: any) => {
    if (!pat) return;
    for (const d of DAY_KEYS) {
      const v = pat[d];
      if (!v) continue;
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string") out[d].push([v[0] as string, v[1] as string]);
      else if (Array.isArray(v)) for (const p of v) if (Array.isArray(p) && p.length === 2) out[d].push([p[0], p[1]]);
    }
  };
  if (wh && wh.mode === "alternating" && wh.alt) {
    consume(wh.alt.even); consume(wh.alt.odd);
  } else consume(wh);
  return out;
}
function weeklyHasOverlap(a: any, b: any): boolean {
  const sa = extractAllWeeklySlots(a);
  const sb = extractAllWeeklySlots(b);
  for (const d of DAY_KEYS) for (const x of sa[d]) for (const y of sb[d]) if (timeRangeOverlap(x, y)) return true;
  return false;
}
function windowsOverlap(a: any[] | null, b: any[] | null): boolean {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  for (const x of aa) for (const y of bb) {
    if (!x?.start || !x?.end || !y?.start || !y?.end) continue;
    const xs = new Date(x.start).getTime(), xe = new Date(x.end).getTime();
    const ys = new Date(y.start).getTime(), ye = new Date(y.end).getTime();
    if (xs < ye && ys < xe) return true;
  }
  return false;
}
function hasAnyWeekly(wh: any): boolean {
  const s = extractAllWeeklySlots(wh);
  for (const d of DAY_KEYS) if (s[d].length > 0) return true;
  return false;
}
function hasAnyWindow(wins: any[] | null): boolean {
  return Array.isArray(wins) && wins.some((w) => w?.start && w?.end);
}
function assignmentsConflict(a: AnyAssign, b: AnyAssign): boolean {
  // Always = no time restriction → conflicts with any active assignment
  if (a.kind === "always" || b.kind === "always") return true;
  // Both scheduled: conflict if their weekly ranges overlap OR any windows overlap.
  // (Windows restrict scheduling, but to keep exclusivity conservative we still
  //  flag overlapping windows even without aligned weekly slots.)
  if (weeklyHasOverlap(a.working_hours_json, b.working_hours_json)) return true;
  if (windowsOverlap(a.availability_windows_json, b.availability_windows_json)) return true;
  // If one has no weekly + no windows configured, treat as effectively always
  const aEmpty = !hasAnyWeekly(a.working_hours_json) && !hasAnyWindow(a.availability_windows_json);
  const bEmpty = !hasAnyWeekly(b.working_hours_json) && !hasAnyWindow(b.availability_windows_json);
  if (aEmpty || bEmpty) return true;
  return false;
}

export const listStaffResourceAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ organizationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("staff_resource_assignments")
      .select("*, staff_profiles(display_name), resources(name, type)")
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertStaffResourceAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpsertInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Exkluzivitás: szoba/szék típusnál a munkatárs időben nem fedheti át
    // egy másik szoba/szék hozzárendelést.
    const { data: thisRes } = await supabaseAdmin
      .from("resources").select("type").eq("id", data.resourceId).single();
    if (thisRes && EXCLUSIVE_TYPES.has(thisRes.type) && data.active) {
      const { data: others } = await supabaseAdmin
        .from("staff_resource_assignments")
        .select("id, kind, working_hours_json, availability_windows_json, resource_id, resources(name, type)")
        .eq("organization_id", data.organizationId)
        .eq("staff_profile_id", data.staffProfileId)
        .eq("active", true);

      const candidate: AnyAssign = {
        kind: data.kind,
        working_hours_json: data.kind === "scheduled" ? (data.workingHours ?? {}) : {},
        availability_windows_json: data.kind === "scheduled" ? (data.windows ?? []) : [],
      };

      for (const row of (others ?? []) as any[]) {
        if (data.id && row.id === data.id) continue;
        if (row.resource_id === data.resourceId) continue;
        const otherType = row.resources?.type;
        if (!EXCLUSIVE_TYPES.has(otherType)) continue;
        if (assignmentsConflict(candidate, row as AnyAssign)) {
          throw new Error(
            `Ütközés: a munkatárs ebben az időszakban már a(z) "${row.resources?.name}" (${otherType}) erőforráshoz van rendelve. Egy munkatárs egyszerre csak egy szoba/szék típusú erőforráson lehet.`,
          );
        }
      }
    }

    const payload = {
      organization_id: data.organizationId,
      staff_profile_id: data.staffProfileId,
      resource_id: data.resourceId,
      kind: data.kind,
      working_hours_json: data.kind === "scheduled" ? (data.workingHours ?? {}) : {},
      availability_windows_json: data.kind === "scheduled" ? (data.windows ?? []) : [],
      // legacy mezők kinullázva
      weekly_pattern_json: null,
      starts_at: null,
      ends_at: null,
      active: data.active,
    };
    if (data.id) {
      const { error } = await supabase.from("staff_resource_assignments")
        .update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: row, error } = await supabase.from("staff_resource_assignments")
        .insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      return { id: row.id };
    }
  });

export const deleteStaffResourceAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("staff_resource_assignments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
