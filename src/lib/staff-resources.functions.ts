import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/lib/supabase-admin-loader";
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
function emptySlots(): Record<string, [string,string][]> {
  return { mon:[], tue:[], wed:[], thu:[], fri:[], sat:[], sun:[] };
}
function consumeInto(out: Record<string, [string,string][]>, pat: any) {
  if (!pat) return;
  for (const d of DAY_KEYS) {
    const v = pat[d];
    if (!v) continue;
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string") out[d].push([v[0] as string, v[1] as string]);
    else if (Array.isArray(v)) for (const p of v) if (Array.isArray(p) && p.length === 2) out[d].push([p[0], p[1]]);
  }
}
/** Paritás-tudatos kivonat: külön even / odd vödör.
 *  Nem-alternating heti minta esetén mindkét paritásba ugyanaz kerül. */
function extractWeeklySlotsByParity(wh: any): { even: Record<string,[string,string][]>; odd: Record<string,[string,string][]> } {
  const even = emptySlots();
  const odd = emptySlots();
  if (!wh) return { even, odd };
  if (wh.mode === "alternating" && wh.alt) {
    consumeInto(even, wh.alt.even);
    consumeInto(odd, wh.alt.odd);
  } else {
    consumeInto(even, wh);
    consumeInto(odd, wh);
  }
  return { even, odd };
}
function extractAllWeeklySlots(wh: any): Record<string, [string,string][]> {
  // Megtartva a hatáskör-ellenőrzéshez (hasAnyWeekly) — itt nem fontos a paritás.
  const { even, odd } = extractWeeklySlotsByParity(wh);
  const out = emptySlots();
  for (const d of DAY_KEYS) out[d] = [...even[d], ...odd[d]];
  return out;
}
function weeklyHasOverlap(a: any, b: any): boolean {
  const sa = extractWeeklySlotsByParity(a);
  const sb = extractWeeklySlotsByParity(b);
  for (const parity of ["even", "odd"] as const) {
    for (const d of DAY_KEYS) {
      for (const x of sa[parity][d]) for (const y of sb[parity][d]) {
        if (timeRangeOverlap(x, y)) return true;
      }
    }
  }
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
function validWindowRanges(wins: any[] | null): Range[] {
  return (Array.isArray(wins) ? wins : [])
    .filter((w) => w?.start && w?.end)
    .map((w) => ({ start: new Date(w.start).getTime(), end: new Date(w.end).getTime() }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.start < w.end);
}
function scheduledRangesWithin(a: AnyAssign, span: Range, tz: string): Range[] {
  const wh = a.working_hours_json ?? {};
  const wins = validWindowRanges(a.availability_windows_json);
  const weeklyOn = hasAnyWeekly(wh);
  if (!weeklyOn && wins.length === 0) return [];
  const out: Range[] = [];
  // Heti minta: a teljes spanre kivetítve
  if (weeklyOn) {
    // -1 nap, hogy az éjfélen átnyúló (overnight) minta is bekerüljön.
    let cursor = addZonedDays(zonedStartOfDay(new Date(span.start), tz), -1, tz);
    while (cursor.getTime() < span.end) {
      const zp = getZonedParts(cursor, tz);
      for (const r of dayRangesFromWeekly(wh, { year: zp.year, month: zp.month, day: zp.day, weekday: zp.weekday }, tz)) {
        const s = Math.max(r.start.getTime(), span.start);
        const e = Math.min(r.end.getTime(), span.end);
        if (s < e) out.push({ start: s, end: e });
      }
      cursor = addZonedDays(cursor, 1, tz);
    }
  }
  // Egyedi ablakok: additívan hozzáadva
  for (const w of wins) {
    const s = Math.max(w.start, span.start);
    const e = Math.min(w.end, span.end);
    if (s < e) out.push({ start: s, end: e });
  }
  return out;
}
type StaffAvailability = { working_hours_json: any; availability_windows_json: any[] | null };

/** Egy "always" hozzárendelést a munkatárs tényleges rendelkezésre állására (heti munkaidő ∩ ablakok)
 *  vetít — így ütközés-vizsgálatkor csak az igazi munkaidőre blokkol. */
function effectiveAssign(a: AnyAssign, staff?: StaffAvailability | null): AnyAssign {
  if (a.kind !== "always") return a;
  if (!staff) return { kind: "scheduled", working_hours_json: {}, availability_windows_json: [] };
  const hasWh = hasAnyWeekly(staff.working_hours_json);
  const hasWin = hasAnyWindow(staff.availability_windows_json);
  if (!hasWh && !hasWin) return { kind: "scheduled", working_hours_json: {}, availability_windows_json: [] };
  return {
    kind: "scheduled",
    working_hours_json: staff.working_hours_json ?? {},
    availability_windows_json: staff.availability_windows_json ?? [],
  };
}

function assignmentsConflict(a: AnyAssign, b: AnyAssign, tz = "Europe/Budapest", staffA?: StaffAvailability | null, staffB?: StaffAvailability | null): boolean {
  const ea = effectiveAssign(a, staffA);
  const eb = effectiveAssign(b, staffB);
  // Always = no time restriction → conflicts with any active assignment
  if (ea.kind === "always" || eb.kind === "always") return true;
  // If one has no weekly + no windows configured, treat as effectively always
  const aEmpty = !hasAnyWeekly(ea.working_hours_json) && !hasAnyWindow(ea.availability_windows_json);
  const bEmpty = !hasAnyWeekly(eb.working_hours_json) && !hasAnyWindow(eb.availability_windows_json);
  if (aEmpty || bEmpty) return false;
  const aWins = validWindowRanges(ea.availability_windows_json);
  const bWins = validWindowRanges(eb.availability_windows_json);
  if (aWins.length === 0 && bWins.length === 0) return weeklyHasOverlap(ea.working_hours_json, eb.working_hours_json);
  const spans = aWins.length > 0 && bWins.length > 0
    ? aWins.flatMap((aw) => bWins.map((bw) => ({ start: Math.max(aw.start, bw.start), end: Math.min(aw.end, bw.end) }))).filter((r) => r.start < r.end)
    : (aWins.length > 0 ? aWins : bWins);
  for (const span of spans) {
    const ar = scheduledRangesWithin(ea, span, tz);
    const br = scheduledRangesWithin(eb, span, tz);
    for (const x of ar) for (const y of br) if (rangesOverlap(x, y)) return true;
  }
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
    const supabaseAdmin = await getSupabaseAdmin();

    const { data: org } = await supabaseAdmin
      .from("organizations").select("timezone, dst_enabled").eq("id", data.organizationId).single();
    const tz = resolveBusinessTz(org?.timezone || "Europe/Budapest", org?.dst_enabled !== false);

    const { data: thisRes } = await supabaseAdmin
      .from("resources").select("type, name, capacity").eq("id", data.resourceId).single();

    // Szabály: eszköz típusú erőforrás NEM rendelhető munkatárshoz.
    // Eszközt csak szolgáltatáshoz (igény) és szobához/székhez (helyszín) lehet rendelni.
    if (thisRes && (thisRes as any).type === "equipment") {
      throw new Error(
        `Az "${(thisRes as any).name}" eszköz típusú erőforrás nem rendelhető munkatárshoz. Az eszközöket a szolgáltatásokhoz (igény) és a szobákhoz/székekhez (helyszín) kell rendelni.`,
      );
    }

    const candidate: AnyAssign = {
      kind: data.kind,
      working_hours_json: data.kind === "scheduled" ? (data.workingHours ?? {}) : {},
      availability_windows_json: data.kind === "scheduled" ? (data.windows ?? []) : [],
    };

    // A jelölt munkatárs munkaideje (az "always" effektív kivetítéséhez).
    const { data: candidateStaff } = await supabaseAdmin
      .from("staff_profiles")
      .select("working_hours_json, availability_windows_json")
      .eq("id", data.staffProfileId).single();
    const candidateAvail: StaffAvailability = {
      working_hours_json: candidateStaff?.working_hours_json ?? {},
      availability_windows_json: (candidateStaff as any)?.availability_windows_json ?? [],
    };

    // Munkatárs neve a hibaüzenethez / összehasonlító dialóghoz
    const { data: candidateStaffName } = await supabaseAdmin
      .from("staff_profiles").select("display_name").eq("id", data.staffProfileId).single();
    const candidateSummary = {
      staffName: candidateStaffName?.display_name ?? "?",
      resourceId: data.resourceId,
      resourceName: (thisRes as any)?.name ?? "?",
      resourceType: (thisRes as any)?.type ?? "?",
      kind: data.kind,
      working_hours_json: data.kind === "scheduled" ? (data.workingHours ?? {}) : {},
      availability_windows_json: data.kind === "scheduled" ? (data.windows ?? []) : [],
      staffWorkingHours: candidateAvail.working_hours_json ?? {},
      staffWindows: candidateAvail.availability_windows_json ?? [],
    };

    // 1) Munkatárs-oldali exkluzivitás (szabály 2): egy munkatárs egyidőben csak 1 szoba/szék hozzárendelésen.
    if (thisRes && EXCLUSIVE_TYPES.has(thisRes.type) && data.active) {
      const { data: others } = await supabaseAdmin
        .from("staff_resource_assignments")
        .select("id, kind, working_hours_json, availability_windows_json, resource_id, resources(name, type), staff_profiles(display_name)")
        .eq("organization_id", data.organizationId)
        .eq("staff_profile_id", data.staffProfileId)
        .eq("active", true);
      const conflictHits: any[] = [];
      for (const row of (others ?? []) as any[]) {
        if (data.id && row.id === data.id) continue;
        if (row.resource_id === data.resourceId) continue;
        const otherType = row.resources?.type;
        if (!EXCLUSIVE_TYPES.has(otherType)) continue;
        if (assignmentsConflict(candidate, row as AnyAssign, tz, candidateAvail, candidateAvail)) {
          conflictHits.push({
            id: row.id,
            staffName: row.staff_profiles?.display_name ?? candidateSummary.staffName,
            resourceId: row.resource_id,
            resourceName: row.resources?.name ?? "?",
            resourceType: otherType,
            kind: row.kind,
            working_hours_json: row.working_hours_json ?? {},
            availability_windows_json: row.availability_windows_json ?? [],
          });
        }
      }
      if (conflictHits.length > 0) {
        const names = conflictHits.map((c) => `"${c.resourceName}"`).join(", ");
        throw new Error("__CONFLICT__:" + JSON.stringify({
          type: "exclusive",
          message: `Ütközés: a munkatárs ebben az időszakban már a(z) ${names} (${conflictHits[0].resourceType}) erőforráshoz van rendelve. Egy munkatárs egyszerre csak egy szoba/szék típusú erőforráson lehet.`,
          candidate: candidateSummary,
          conflicts: conflictHits,
        }));
      }
    }

    // 2) Erőforrás-oldali kapacitás-ellenőrzés (szabály 3,4,5):
    //    szék = 1, eszköz = 1, szoba = capacity. Más típusnál nincs korlát.
    if (thisRes && data.active) {
      let resourceCapacity: number | null = null;
      if (thisRes.type === "chair") resourceCapacity = 1;
      else if (thisRes.type === "equipment") resourceCapacity = 1;
      else if (thisRes.type === "room") resourceCapacity = (thisRes as any).capacity ?? 1;
      if (resourceCapacity !== null) {
        const { data: peers } = await supabaseAdmin
          .from("staff_resource_assignments")
          .select("id, kind, working_hours_json, availability_windows_json, staff_profile_id, staff_profiles(display_name, working_hours_json, availability_windows_json)")
          .eq("organization_id", data.organizationId)
          .eq("resource_id", data.resourceId)
          .eq("active", true);
        const conflicting = ((peers ?? []) as any[]).filter((row) => {
          if (data.id && row.id === data.id) return false;
          if (row.staff_profile_id === data.staffProfileId) return false;
          const peerStaff: StaffAvailability = {
            working_hours_json: row.staff_profiles?.working_hours_json ?? {},
            availability_windows_json: row.staff_profiles?.availability_windows_json ?? [],
          };
          return assignmentsConflict(candidate, row as AnyAssign, tz, candidateAvail, peerStaff);
        });
        const usedWithCandidate = conflicting.length + 1;
        if (usedWithCandidate > resourceCapacity) {
          const names = conflicting.slice(0, 3).map((c) => c.staff_profiles?.display_name ?? "?").join(", ");
          const typeLabel = thisRes.type === "chair" ? "szék" : thisRes.type === "equipment" ? "eszköz" : "szoba";
          const conflictHits = conflicting.map((row: any) => ({
            id: row.id,
            staffId: row.staff_profile_id,
            staffName: row.staff_profiles?.display_name ?? "?",
            resourceId: data.resourceId,
            resourceName: (thisRes as any).name,
            resourceType: thisRes.type,
            kind: row.kind,
            working_hours_json: row.working_hours_json ?? {},
            availability_windows_json: row.availability_windows_json ?? [],
            staffWorkingHours: row.staff_profiles?.working_hours_json ?? {},
            staffWindows: row.staff_profiles?.availability_windows_json ?? [],
          }));
          throw new Error("__CONFLICT__:" + JSON.stringify({
            type: "capacity",
            message: `Ütközés: a(z) "${thisRes.name}" ${typeLabel} kapacitása ${resourceCapacity} egyidejű munkatárs, de már hozzá van rendelve ütköző időszakban: ${names}.`,
            candidate: candidateSummary,
            conflicts: conflictHits,
          }));
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

// =====================================================================
// Effektív rendelkezésre állás kiszámítása egy staff+resource párra.
// - Indul a munkatárs heti munkaidejéből (working_hours_json)
// - Kivonja: másik szoba/szék hozzárendelés ütközései (egy munkatárs egyszerre 1 helyen)
// - Kivonja: az erőforrás már létező foglalásai (ha used >= capacity)
// Visszaadja: napi bontás (zónabéli) + javasolt windows (datetime ablakok).
// =====================================================================

const ComputeInput = z.object({
  organizationId: z.string().uuid(),
  staffProfileId: z.string().uuid(),
  resourceId: z.string().uuid(),
  excludeAssignmentId: z.string().uuid().optional(),
  days: z.number().int().min(1).max(120).default(56),
});

type Range = { start: number; end: number };
type Block = { range: Range; reason: string };

const EXCL = new Set(["room", "chair"]);
const DAY_KEYS_ORD = ["sun","mon","tue","wed","thu","fri","sat"] as const;

function rangesOverlap(a: Range, b: Range): boolean { return a.start < b.end && a.end > b.start; }
function extractWeeklySlots(wh: any): Record<string, [string,string][]> {
  const out: Record<string, [string,string][]> = { mon:[], tue:[], wed:[], thu:[], fri:[], sat:[], sun:[] };
  if (!wh) return out;
  const consume = (pat: any) => {
    if (!pat) return;
    for (const d of ["mon","tue","wed","thu","fri","sat","sun"]) {
      const v = pat[d]; if (!v) continue;
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string") out[d].push([v[0] as string, v[1] as string]);
      else if (Array.isArray(v)) for (const p of v) if (Array.isArray(p) && p.length === 2) out[d].push([p[0], p[1]]);
    }
  };
  if (wh && wh.mode === "alternating" && wh.alt) { consume(wh.alt.even); consume(wh.alt.odd); }
  else consume(wh);
  return out;
}
function hasAnyWeekly2(wh: any): boolean {
  const s = extractWeeklySlots(wh);
  return (["mon","tue","wed","thu","fri","sat","sun"] as const).some((d) => s[d].length > 0);

}

/** Egy másik hozzárendelés által ténylegesen blokkolt [start,end) UTC intervallumok az adott napon belül. */
function assignmentBlockedRanges(a: any, dayStart: Date, dayEnd: Date, tz: string): Range[] {
  if (!a.active) return [];
  if (a.kind === "always") return [{ start: dayStart.getTime(), end: dayEnd.getTime() }];

  const wh = a.working_hours_json ?? {};
  const wins: any[] = Array.isArray(a.availability_windows_json) ? a.availability_windows_json : [];
  const validWins: Range[] = wins
    .filter((w) => w && typeof w.start === "string" && typeof w.end === "string")
    .map((w) => ({ start: new Date(w.start).getTime(), end: new Date(w.end).getTime() }));
  const weeklyOn = hasAnyWeekly2(wh);

  if (!weeklyOn && validWins.length === 0) return [];

  const out: Range[] = [];
  if (weeklyOn) {
    // Az aktuális napi mintán felül az előző napit is figyeljük, hogy az
    // éjfélen átnyúló (overnight) tartomány is megjelenjen ezen a napon.
    const prevDay = addZonedDays(dayStart, -1, tz);
    const days = [prevDay, dayStart];
    for (const dRef of days) {
      const zp = getZonedParts(dRef, tz);
      for (const r of dayRangesFromWeekly(wh, { year: zp.year, month: zp.month, day: zp.day, weekday: zp.weekday }, tz)) {
        const s = Math.max(r.start.getTime(), dayStart.getTime());
        const e = Math.min(r.end.getTime(), dayEnd.getTime());
        if (s < e) out.push({ start: s, end: e });
      }
    }
  }
  // Egyedi ablakok additívan, a napra szűkítve
  for (const w of validWins) {
    if (w.start < dayEnd.getTime() && w.end > dayStart.getTime()) {
      out.push({ start: Math.max(w.start, dayStart.getTime()), end: Math.min(w.end, dayEnd.getTime()) });
    }
  }
  return out;
}

/** Intervallumok kivonása + ok megjegyzése. Eredmény: kept (szabad) szegmensek és blokkolt szegmensek okkal. */
function subtractWithReasons(base: Range[], blocks: Block[]): { kept: Range[]; removed: Block[] } {
  const kept: Range[] = [];
  const removed: Block[] = [];
  for (const b of base) {
    const sortedBlocks = blocks
      .map((bl) => ({ range: { start: Math.max(bl.range.start, b.start), end: Math.min(bl.range.end, b.end) }, reason: bl.reason }))
      .filter((bl) => bl.range.start < bl.range.end)
      .sort((x, y) => x.range.start - y.range.start);
    let cursor = b.start;
    for (const bl of sortedBlocks) {
      if (bl.range.start > cursor) kept.push({ start: cursor, end: bl.range.start });
      removed.push({ range: { start: Math.max(bl.range.start, cursor), end: bl.range.end }, reason: bl.reason });
      cursor = Math.max(cursor, bl.range.end);
      if (cursor >= b.end) break;
    }
    if (cursor < b.end) kept.push({ start: cursor, end: b.end });
  }
  return { kept, removed };
}

function mergeRanges(rs: Range[]): Range[] {
  const sorted = [...rs].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    if (r.start >= r.end) continue;
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export const computeStaffResourceEffectiveAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ComputeInput.parse(d))
  .handler(async ({ data }) => {
    const admin = await getSupabaseAdmin();

    const { data: org } = await admin.from("organizations")
      .select("timezone, dst_enabled").eq("id", data.organizationId).single();
    const tz = resolveBusinessTz(org?.timezone || "Europe/Budapest", org?.dst_enabled !== false);

    const { data: staff } = await admin.from("staff_profiles")
      .select("id, display_name, working_hours_json, availability_windows_json")
      .eq("id", data.staffProfileId).single();
    if (!staff) throw new Error("Munkatárs nem található");

    const { data: thisRes } = await admin.from("resources")
      .select("id, name, type, capacity").eq("id", data.resourceId).single();
    if (!thisRes) throw new Error("Erőforrás nem található");

    // Másik szoba/szék hozzárendelések (ugyanaz a munkatárs, más erőforrás)
    const { data: others } = await admin.from("staff_resource_assignments")
      .select("id, kind, working_hours_json, availability_windows_json, active, resource_id, resources(name, type)")
      .eq("organization_id", data.organizationId)
      .eq("staff_profile_id", data.staffProfileId)
      .eq("active", true);
    const otherExcl = (others ?? []).filter((a: any) =>
      a.resource_id !== data.resourceId
      && (!data.excludeAssignmentId || a.id !== data.excludeAssignmentId)
      && EXCL.has(a.resources?.type),
    );

    // A start és end ablak (a munkatárs egyedi ablakai opcionálisan szűkítenek)
    const today = zonedStartOfDay(new Date(), tz);
    const until = addZonedDays(today, data.days, tz);

    const staffWins: Range[] = Array.isArray(staff.availability_windows_json)
      ? (staff.availability_windows_json as any[])
          .filter((w) => w && typeof w.start === "string" && typeof w.end === "string")
          .map((w) => ({ start: new Date(w.start).getTime(), end: new Date(w.end).getTime() }))
      : [];

    // Erőforrás foglalásai a kapcsolódó intervallumban
    const { data: bookings } = await admin.from("bookings")
      .select("start_at, end_at, resource_id, service_id")
      .eq("organization_id", data.organizationId)
      .in("status", ["confirmed", "checked_in", "pending_payment"])
      .lt("start_at", until.toISOString())
      .gt("end_at", today.toISOString())
      .eq("resource_id", data.resourceId);

    const capacity = (thisRes as any).capacity ?? 1;

    type Segment = { startISO: string; endISO: string; status: "available" | "blocked"; reasons: string[] };
    type Day = { dateISO: string; weekdayKey: string; segments: Segment[]; windows: { start: string; end: string }[] };
    const days: Day[] = [];
    const allWindows: Range[] = [];

    for (let i = 0; i < data.days; i++) {
      const dayStart = addZonedDays(today, i, tz);
      const dayEnd = addZonedDays(today, i + 1, tz);
      const zp = getZonedParts(dayStart, tz);
      const weeklyRanges = dayRangesFromWeekly(staff.working_hours_json ?? {}, { year: zp.year, month: zp.month, day: zp.day, weekday: zp.weekday }, tz)
        .map((r) => ({ start: r.start.getTime(), end: r.end.getTime() }));

      // staff egyedi ablakok szűkítése
      let base: Range[] = weeklyRanges;
      if (staffWins.length > 0) {
        const intersected: Range[] = [];
        for (const r of base) for (const w of staffWins) {
          const s = Math.max(r.start, w.start), e = Math.min(r.end, w.end);
          if (s < e) intersected.push({ start: s, end: e });
        }
        base = intersected;
      }

      const blocks: Block[] = [];
      // 1) Más szoba/szék hozzárendelés ütközései
      for (const a of otherExcl) {
        const ranges = assignmentBlockedRanges(a, dayStart, dayEnd, tz);
        for (const r of ranges) blocks.push({ range: r, reason: `Ütközés: másik helyhez rendelve (${(a as any).resources?.name})` });
      }
      // 2) Erőforrás foglalásai (használat >= kapacitás → blokk)
      // Egyszerű, konzervatív: minden foglalás egy slotot foglal; ha párhuzamosan annyi, mint a kapacitás → blokkolt.
      // Számoljuk: minden booking egy [s,e) → ha capacity=1, már egy is blokkol; capacity>1: egyesével hozzáadjuk és kibontjuk.
      const todayBookings = (bookings ?? []).filter((b: any) => new Date(b.end_at).getTime() > dayStart.getTime() && new Date(b.start_at).getTime() < dayEnd.getTime());
      if (capacity <= 1) {
        for (const b of todayBookings) {
          blocks.push({
            range: { start: Math.max(new Date(b.start_at).getTime(), dayStart.getTime()), end: Math.min(new Date(b.end_at).getTime(), dayEnd.getTime()) },
            reason: `Erőforrás már foglalt (létező foglalás)`,
          });
        }
      } else {
        // capacity>1: 1 perces granularitás a használati szint meghatározásához (max 1440 lépés/nap)
        const stepMs = 60_000;
        const start = dayStart.getTime();
        const end = dayEnd.getTime();
        let runStart: number | null = null;
        for (let t = start; t < end; t += stepMs) {
          let used = 0;
          for (const b of todayBookings) {
            const bs = new Date(b.start_at).getTime(), be = new Date(b.end_at).getTime();
            if (bs <= t && t < be) used++;
          }
          const isBlocked = used >= capacity;
          if (isBlocked && runStart === null) runStart = t;
          else if (!isBlocked && runStart !== null) {
            blocks.push({ range: { start: runStart, end: t }, reason: `Erőforrás kapacitás elérve (${capacity})` });
            runStart = null;
          }
        }
        if (runStart !== null) blocks.push({ range: { start: runStart, end }, reason: `Erőforrás kapacitás elérve (${capacity})` });
      }

      const { kept, removed } = subtractWithReasons(base, blocks);
      const keptMerged = mergeRanges(kept);

      // szegmensek időrend szerint (available + blocked) egyetlen sorrendben
      const all: Segment[] = [];
      for (const k of keptMerged) all.push({ startISO: new Date(k.start).toISOString(), endISO: new Date(k.end).toISOString(), status: "available", reasons: [] });
      // csoportosítsuk a blokkolt szegmenseket azonos időszak alapján reason-listához
      const blockedByRange = new Map<string, string[]>();
      for (const r of removed) {
        const key = `${r.range.start}-${r.range.end}`;
        if (!blockedByRange.has(key)) blockedByRange.set(key, []);
        blockedByRange.get(key)!.push(r.reason);
      }
      for (const [key, reasons] of blockedByRange) {
        const [s, e] = key.split("-").map(Number);
        all.push({ startISO: new Date(s).toISOString(), endISO: new Date(e).toISOString(), status: "blocked", reasons: Array.from(new Set(reasons)) });
      }
      all.sort((a, b) => a.startISO.localeCompare(b.startISO));

      const dateISO = `${zp.year.toString().padStart(4, "0")}-${String(zp.month).padStart(2, "0")}-${String(zp.day).padStart(2, "0")}`;
      days.push({
        dateISO,
        weekdayKey: DAY_KEYS_ORD[zp.weekday],
        segments: all,
        windows: keptMerged.map((r) => ({ start: new Date(r.start).toISOString(), end: new Date(r.end).toISOString() })),
      });

      for (const k of keptMerged) allWindows.push(k);
    }

    return {
      tz,
      capacity,
      resourceName: (thisRes as any).name,
      staffName: (staff as any).display_name,
      days,
      windows: mergeRanges(allWindows).map((r) => ({ start: new Date(r.start).toISOString(), end: new Date(r.end).toISOString() })),
    };
  });

// =====================================================================
// Munkatárs rendelkezésre állásának változásakor a hozzá tartozó scheduled
// erőforrás-hozzárendelések heti mintáját (és időablakait) az új munkaidőre
// metsszük — így nem maradnak "kilógó" foglalási sávok.
// =====================================================================

function intersectTimeRanges(a: [string,string][], b: [string,string][]): [string,string][] {
  const out: [string,string][] = [];
  for (const x of a) for (const y of b) {
    const s = x[0] > y[0] ? x[0] : y[0];
    const e = x[1] < y[1] ? x[1] : y[1];
    if (s < e) out.push([s, e]);
  }
  out.sort((p, q) => p[0].localeCompare(q[0]));
  const merged: [string,string][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) {
      if (r[1] > last[1]) last[1] = r[1];
    } else merged.push([r[0], r[1]]);
  }
  return merged;
}

function packDay(ranges: [string,string][]): any {
  if (ranges.length === 0) return null;
  if (ranges.length === 1) return ranges[0];
  return ranges;
}

function intersectWeeklyWithStaff(assignWh: any, staffWh: any): any {
  const a = extractWeeklySlotsByParity(assignWh);
  const s = extractWeeklySlotsByParity(staffWh);
  const isAlt = !!(assignWh && assignWh.mode === "alternating") || !!(staffWh && staffWh.mode === "alternating");
  if (isAlt) {
    const even: any = {};
    const odd: any = {};
    for (const d of DAY_KEYS) {
      even[d] = packDay(intersectTimeRanges(a.even[d], s.even[d]));
      odd[d] = packDay(intersectTimeRanges(a.odd[d], s.odd[d]));
    }
    return { mode: "alternating", alt: { even, odd } };
  }
  const flat: any = {};
  for (const d of DAY_KEYS) {
    flat[d] = packDay(intersectTimeRanges(a.even[d], s.even[d]));
  }
  return flat;
}

export const syncAssignmentsToStaffAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ staffProfileId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: staff } = await supabase
      .from("staff_profiles")
      .select("working_hours_json, availability_windows_json")
      .eq("id", data.staffProfileId).single();
    if (!staff) throw new Error("Munkatárs nem található");

    const { data: rows } = await supabase
      .from("staff_resource_assignments")
      .select("id, kind, working_hours_json, availability_windows_json")
      .eq("staff_profile_id", data.staffProfileId)
      .eq("kind", "scheduled");

    const staffWh = staff.working_hours_json ?? {};
    const staffWins = Array.isArray(staff.availability_windows_json) ? (staff.availability_windows_json as any[]) : [];
    const staffHasWeekly = hasAnyWeekly(staffWh);

    let updated = 0;
    for (const r of rows ?? []) {
      const newWh = staffHasWeekly
        ? intersectWeeklyWithStaff(r.working_hours_json ?? {}, staffWh)
        : (r.working_hours_json ?? {});

      let newWins: any[] = Array.isArray(r.availability_windows_json) ? r.availability_windows_json as any[] : [];
      if (staffWins.length > 0 && newWins.length > 0) {
        const clipped: any[] = [];
        for (const w of newWins) {
          if (!w?.start || !w?.end) continue;
          const ws = new Date(w.start).getTime(), we = new Date(w.end).getTime();
          for (const sw of staffWins) {
            if (!sw?.start || !sw?.end) continue;
            const ss = new Date(sw.start).getTime(), se = new Date(sw.end).getTime();
            const s2 = Math.max(ws, ss), e2 = Math.min(we, se);
            if (s2 < e2) clipped.push({ start: new Date(s2).toISOString(), end: new Date(e2).toISOString() });
          }
        }
        newWins = clipped;
      }

      const { error } = await supabase.from("staff_resource_assignments")
        .update({ working_hours_json: newWh, availability_windows_json: newWins })
        .eq("id", r.id);
      if (!error) updated++;
    }
    return { updated };
  });
