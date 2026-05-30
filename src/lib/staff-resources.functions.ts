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
  const weeklyOn = hasAnyWeekly(wh);

  if (!weeklyOn && validWins.length === 0) return [{ start: dayStart.getTime(), end: dayEnd.getTime() }];

  let weeklyRanges: Range[] = [];
  if (weeklyOn) {
    const zp = getZonedParts(dayStart, tz);
    weeklyRanges = dayRangesFromWeekly(wh, { year: zp.year, month: zp.month, day: zp.day, weekday: zp.weekday }, tz)
      .map((r) => ({ start: r.start.getTime(), end: r.end.getTime() }));
  }

  // Heti minta intervallumait szűkítjük az ablakokra (ha vannak)
  if (weeklyOn && validWins.length > 0) {
    const out: Range[] = [];
    for (const r of weeklyRanges) for (const w of validWins) {
      const s = Math.max(r.start, w.start), e = Math.min(r.end, w.end);
      if (s < e) out.push({ start: s, end: e });
    }
    return out;
  }
  if (weeklyOn) return weeklyRanges;
  // csak ablakok
  return validWins.filter((w) => w.start < dayEnd.getTime() && w.end > dayStart.getTime())
    .map((w) => ({ start: Math.max(w.start, dayStart.getTime()), end: Math.min(w.end, dayEnd.getTime()) }));
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
    const admin = supabaseAdmin;

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
