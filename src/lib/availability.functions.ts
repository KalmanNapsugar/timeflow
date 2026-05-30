import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  addZonedDays,
  dayRangesFromWeekly,
  getZonedParts,
  resolveBusinessTz,
  zonedStartOfDay,
  zonedTimeToUtc,
} from "@/lib/timezone";
import { groupResourceRows, definitelyConsumed, allGroupsHaveFreeResource } from "@/lib/resource-groups";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type Range = { start: Date; end: Date };

function intersectRanges(a: Range[], b: Range[]): Range[] {
  const out: Range[] = [];
  for (const x of a) for (const y of b) {
    const s = x.start > y.start ? x.start : y.start;
    const e = x.end < y.end ? x.end : y.end;
    if (s < e) out.push({ start: s, end: e });
  }
  return out;
}

function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && a.end > b.start;
}

const Input = z.object({
  organizationId: z.string().uuid(),
  serviceId: z.string().uuid(),
  staffProfileId: z.string().uuid().nullable(),
  fromISO: z.string(),
  days: z.number().int().min(1).max(60).default(14),
});

export const getAvailableSlots = createServerFn({ method: "POST" })
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data }) => {
    const admin = supabaseAdmin;

    const { data: org } = await admin
      .from("organizations").select("timezone, dst_enabled").eq("id", data.organizationId).single();
    const tz = resolveBusinessTz(org?.timezone || "Europe/Budapest", org?.dst_enabled !== false);

    const { data: svc } = await admin
      .from("services").select("*").eq("id", data.serviceId).single();
    if (!svc) throw new Error("Szolgáltatás nem található");
    const dur = svc.duration_minutes;
    const svcLead: number = (svc as any).min_lead_time_minutes ?? 0;

    const { data: staffSvc } = await admin
      .from("staff_services").select("staff_profile_id").eq("service_id", data.serviceId);
    const eligibleIds = new Set((staffSvc ?? []).map((r: any) => r.staff_profile_id));
    if (data.staffProfileId) {
      if (!eligibleIds.has(data.staffProfileId)) return { slots: [] as { iso: string; staffProfileId: string }[] };
    }

    const staffQuery = admin
      .from("staff_profiles").select("*")
      .eq("organization_id", data.organizationId)
      .eq("active", true);
    if (data.staffProfileId) staffQuery.eq("id", data.staffProfileId);
    const { data: staffRows } = await staffQuery;
    const staff = (staffRows ?? []).filter((s: any) =>
      data.staffProfileId ? true : eligibleIds.has(s.id),
    );
    if (staff.length === 0) return { slots: [] };

    // Az ablak az üzlet időzónájában értelmezett napokban van
    const from = zonedStartOfDay(new Date(data.fromISO), tz);
    const until = addZonedDays(from, data.days, tz);

    const { data: bookings } = await admin
      .from("bookings")
      .select("staff_profile_id, start_at, end_at, service_id, resource_id")
      .eq("organization_id", data.organizationId)
      .in("status", ["confirmed", "checked_in", "pending_payment"])
      .lt("start_at", until.toISOString())
      .gt("end_at", from.toISOString());

    const { data: svcRes } = await admin
      .from("service_resources").select("resource_id, group_no").eq("service_id", data.serviceId);
    const ourGroupsMap = groupResourceRows(((svcRes ?? []) as any[]).map((r) => ({ service_id: data.serviceId, resource_id: r.resource_id, group_no: r.group_no })));
    const ourGroups = ourGroupsMap.get(data.serviceId) ?? [];

    const { data: assigns } = await admin
      .from("staff_resource_assignments")
      .select("*")
      .eq("organization_id", data.organizationId)
      .eq("active", true);

    const otherSvcIds = Array.from(new Set((bookings ?? []).map((b: any) => b.service_id).filter(Boolean)));
    const { data: otherSvcRes } = otherSvcIds.length > 0
      ? await admin.from("service_resources").select("service_id, resource_id, group_no").in("service_id", otherSvcIds)
      : { data: [] as any[] };
    const otherGroupsMap = groupResourceRows((otherSvcRes ?? []) as any);

    const now = new Date();
    const baseMinStart = new Date(now.getTime() + 30 * 60_000);

    type Slot = { iso: string; staffProfileId: string };
    const out: Slot[] = [];

    for (const s of staff) {
      const working = s.working_hours_json ?? {};
      const windows: { start: string; end: string }[] = Array.isArray(s.availability_windows_json)
        ? (s.availability_windows_json as any[]).filter((w): w is { start: string; end: string } =>
            !!w && typeof w === "object" && typeof (w as any).start === "string" && typeof (w as any).end === "string")
        : [];
      const windowRanges: Range[] = windows.map((w) => ({ start: new Date(w.start), end: new Date(w.end) }));

      const myBookings = (bookings ?? []).filter((b: any) => b.staff_profile_id === s.id);

      // #3 lead time
      const staffLead: number = (s as any).min_lead_time_minutes ?? 0;
      const baseLead = Math.max(svcLead, staffLead);
      const allowInstant: boolean = !!(s as any).allow_instant_after_booking;

      for (let d = 0; d < data.days; d++) {
        // A "nap" az üzlet zónájában értelmezett — DST-átmeneten is helyes hosszúságú
        const dayStartUTC = addZonedDays(from, d, tz);
        const zp = getZonedParts(dayStartUTC, tz);
        let ranges = dayRangesFromWeekly(working, { year: zp.year, month: zp.month, day: zp.day, weekday: zp.weekday }, tz);
        if (ranges.length === 0) continue;
        if (windowRanges.length > 0) {
          ranges = intersectRanges(ranges, windowRanges);
        }

        // van-e ma korábbi confirmed booking → instant engedélyezve
        const dayEndUTC = addZonedDays(dayStartUTC, 1, tz);
        const todayBookings = myBookings.filter((b: any) => {
          const bs = new Date(b.start_at);
          return bs >= dayStartUTC && bs < dayEndUTC;
        });

        for (const r of ranges) {
          const stepMs = dur * 60_000;
          for (let t = r.start.getTime(); t + stepMs <= r.end.getTime(); t += stepMs) {
            const slotStart = new Date(t);
            const slotEnd = new Date(t + stepMs);
            if (slotStart < baseMinStart) continue;

            // lead time alkalmazása erre a slotra
            let effLead = baseLead;
            if (allowInstant && effLead > 0) {
              const hasEarlierToday = todayBookings.some((b: any) => new Date(b.start_at) < slotStart);
              if (hasEarlierToday) effLead = 0;
            }
            if (effLead > 0 && slotStart.getTime() < now.getTime() + effLead * 60_000) continue;


            let ok = true;
            for (const b of myBookings) {
              if (overlaps({ start: slotStart, end: slotEnd }, { start: new Date(b.start_at), end: new Date(b.end_at) })) {
                ok = false; break;
              }
            }
            if (!ok) continue;

            if (ourGroups.length > 0) {
              // OR-csoportos erőforrás-szabályok: minden csoporthoz kell legalább egy szabad erőforrás.
              const blocked = new Set<string>();
              for (const b of (bookings ?? [])) {
                if (b.staff_profile_id === s.id) continue;
                if (!overlaps({ start: slotStart, end: slotEnd }, { start: new Date(b.start_at), end: new Date(b.end_at) })) continue;
                definitelyConsumed({ resource_id: (b as any).resource_id ?? null, service_id: (b as any).service_id }, otherGroupsMap)
                  .forEach((rid) => blocked.add(rid));
              }
              for (const a of (assigns ?? [])) {
                if (a.staff_profile_id === s.id) continue;
                if (assignmentBlocks(a, slotStart, slotEnd, tz)) blocked.add(a.resource_id);
              }
              if (!allGroupsHaveFreeResource(ourGroups, blocked)) ok = false;
            }
            if (!ok) continue;

            out.push({ iso: slotStart.toISOString(), staffProfileId: s.id });
          }
        }
      }
    }

    return { slots: out };
  });

function assignmentBlocks(a: any, start: Date, end: Date, tz: string): boolean {
  if (!a.active) return false;
  if (a.kind === "always") return true;

  // "scheduled": ugyanaz a logika, mint a munkatárs rendelkezésre állásnál.
  // Heti minta (váltott műszak támogatással) + opcionális időablakok.
  const wh = a.working_hours_json ?? {};
  const wins: any[] = Array.isArray(a.availability_windows_json) ? a.availability_windows_json : [];
  const validWins = wins
    .filter((w) => w && typeof w.start === "string" && typeof w.end === "string")
    .map((w) => ({ start: new Date(w.start), end: new Date(w.end) }));
  const hasWeekly = wh && (wh.mode === "alternating" || Object.keys(wh).some((k) => (wh as any)[k]));

  // Ha sem heti, sem ablak nincs → korlátlanul foglal (mintha állandó lenne).
  if (!hasWeekly && validWins.length === 0) return true;

  // Iteráljuk a [start,end) által érintett zónabéli napokat
  let cursor = zonedStartOfDay(start, tz);
  while (cursor < end) {
    const zp = getZonedParts(cursor, tz);
    const ranges = hasWeekly
      ? dayRangesFromWeekly(wh, { year: zp.year, month: zp.month, day: zp.day, weekday: zp.weekday }, tz)
      : [];
    for (const r of ranges) {
      if (start < r.end && end > r.start) {
        // Ha vannak ablakok, csak akkor blokkol, ha az intervallum benne van valamelyikben.
        if (validWins.length === 0) return true;
        if (validWins.some((w) => start >= w.start && end <= w.end)) return true;
      }
    }
    // Ha nincs heti, de van ablak: az ablakok önmagukban blokkolnak.
    if (!hasWeekly) {
      for (const w of validWins) {
        if (start < w.end && end > w.start) return true;
      }
      break;
    }
    cursor = addZonedDays(cursor, 1, tz);
  }
  return false;
}

