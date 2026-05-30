import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WeeklyPattern = z.record(
  z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  z.array(z.tuple([z.string(), z.string()])).nullable(),
).optional();

const UpsertInput = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  staffProfileId: z.string().uuid(),
  resourceId: z.string().uuid(),
  kind: z.enum(["always", "weekly", "window"]),
  weeklyPattern: WeeklyPattern,
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  active: z.boolean().default(true),
});

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const EXCLUSIVE_TYPES = new Set(["room", "chair"]);

type AnyAssign = {
  id?: string;
  kind: "always" | "weekly" | "window";
  weekly_pattern_json: Record<string, [string, string][] | null> | null;
  starts_at: string | null;
  ends_at: string | null;
};

function timeRangeOverlap(a: [string, string], b: [string, string]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}
function weeklyOverlap(a: any, b: any): boolean {
  if (!a || !b) return false;
  for (const d of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
    const ra = (a[d] ?? []) as [string, string][];
    const rb = (b[d] ?? []) as [string, string][];
    for (const x of ra) for (const y of rb) if (timeRangeOverlap(x, y)) return true;
  }
  return false;
}
function windowOverlap(a: AnyAssign, b: AnyAssign): boolean {
  if (!a.starts_at || !a.ends_at || !b.starts_at || !b.ends_at) return false;
  const as = new Date(a.starts_at).getTime();
  const ae = new Date(a.ends_at).getTime();
  const bs = new Date(b.starts_at).getTime();
  const be = new Date(b.ends_at).getTime();
  return as < be && bs < ae;
}
function weeklyTouchesWindow(weekly: any, win: AnyAssign): boolean {
  if (!weekly || !win.starts_at || !win.ends_at) return false;
  const start = new Date(win.starts_at);
  const end = new Date(win.ends_at);
  const dayMs = 86400000;
  for (let t = start.getTime(); t < end.getTime(); t += dayMs) {
    const key = DAY_KEYS[new Date(t).getDay()];
    if (((weekly[key] ?? []) as any[]).length > 0) return true;
  }
  return false;
}
function assignmentsConflict(a: AnyAssign, b: AnyAssign): boolean {
  if (a.kind === "always" || b.kind === "always") return true;
  if (a.kind === "weekly" && b.kind === "weekly") return weeklyOverlap(a.weekly_pattern_json, b.weekly_pattern_json);
  if (a.kind === "window" && b.kind === "window") return windowOverlap(a, b);
  if (a.kind === "weekly" && b.kind === "window") return weeklyTouchesWindow(a.weekly_pattern_json, b);
  if (a.kind === "window" && b.kind === "weekly") return weeklyTouchesWindow(b.weekly_pattern_json, a);
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

    // Exkluzivitás-ellenőrzés: szoba/szék típusú erőforrásnál egy munkatárs
    // időben nem fedheti át másik szoba/szék hozzárendelését.
    const { data: thisRes } = await supabaseAdmin
      .from("resources").select("type").eq("id", data.resourceId).single();
    if (thisRes && EXCLUSIVE_TYPES.has(thisRes.type) && data.active) {
      const { data: others } = await supabaseAdmin
        .from("staff_resource_assignments")
        .select("id, kind, weekly_pattern_json, starts_at, ends_at, resource_id, resources(name, type)")
        .eq("organization_id", data.organizationId)
        .eq("staff_profile_id", data.staffProfileId)
        .eq("active", true);

      const candidate: AnyAssign = {
        kind: data.kind,
        weekly_pattern_json: data.kind === "weekly" ? (data.weeklyPattern ?? null) as any : null,
        starts_at: data.kind === "window" ? (data.startsAt ?? null) : null,
        ends_at: data.kind === "window" ? (data.endsAt ?? null) : null,
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
      weekly_pattern_json: data.kind === "weekly" ? (data.weeklyPattern ?? null) : null,
      starts_at: data.kind === "window" ? data.startsAt : null,
      ends_at: data.kind === "window" ? data.endsAt : null,
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
