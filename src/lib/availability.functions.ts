import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin-loader";
import {
  addZonedDays,
  dayRangesFromWeekly,
  getZonedParts,
  resolveBusinessTz,
  zonedStartOfDay,
} from "@/lib/timezone";
import { groupResourceRows, definitelyConsumed, allGroupsHaveFreeResource, allResourcesInGroups, bumpUsage, blockedFromUsage } from "@/lib/resource-groups";
import { extractEquipmentGroups, definitelyUsedEquipment, locationSupportsAllEquipmentGroups } from "@/lib/equipment-rules";



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
    const admin = await getSupabaseAdmin();

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
      .select("staff_profile_id, start_at, end_at, service_id, resource_id, equipment_ids")
      .eq("organization_id", data.organizationId)
      .in("status", ["confirmed", "checked_in", "pending_payment"])
      .lt("start_at", until.toISOString())
      .gt("end_at", from.toISOString());

    const { data: svcRes } = await admin
      .from("service_resources").select("resource_id, group_no").eq("service_id", data.serviceId);
    const ourGroupsMap = groupResourceRows(((svcRes ?? []) as any[]).map((r) => ({ service_id: data.serviceId, resource_id: r.resource_id, group_no: r.group_no })));
    const ourGroups = ourGroupsMap.get(data.serviceId) ?? [];
    const ourResourceIds = allResourcesInGroups(ourGroups);

    // Erőforrás típusok betöltése (eszköz / szoba / szék elkülönítéshez)
    const resourceTypes = new Map<string, string>();
    const capacities = new Map<string, number>();
    if (ourResourceIds.length > 0) {
      const { data: caps } = await admin
        .from("resources").select("id, capacity, type").in("id", ourResourceIds);
      for (const r of caps ?? []) {
        capacities.set((r as any).id, (r as any).capacity ?? 1);
        resourceTypes.set((r as any).id, (r as any).type);
      }
    }

    // Eszköz-csoportok és helyszín-csoportok szétválasztása
    const equipmentGroups = extractEquipmentGroups(
      (svcRes ?? []).map((r: any) => ({ resource_id: r.resource_id, group_no: r.group_no })),
      resourceTypes,
    );
    const locationGroups = ourGroups.filter((g) =>
      g.every((rid) => resourceTypes.get(rid) !== "equipment"),
    );

    // Eszköz → engedélyezett helyszínek (equipment_locations)
    const allEquipmentIds = Array.from(new Set(equipmentGroups.flat()));
    const equipmentLocationsMap = new Map<string, Set<string>>();
    if (allEquipmentIds.length > 0) {
      const { data: eqLocs } = await admin
        .from("equipment_locations")
        .select("equipment_resource_id, location_resource_id")
        .in("equipment_resource_id", allEquipmentIds);
      for (const el of eqLocs ?? []) {
        const eid = (el as any).equipment_resource_id;
        const lid = (el as any).location_resource_id;
        if (!equipmentLocationsMap.has(eid)) equipmentLocationsMap.set(eid, new Set());
        equipmentLocationsMap.get(eid)!.add(lid);
      }
    }

    const { data: assigns } = await admin
      .from("staff_resource_assignments")
      .select("*")
      .eq("organization_id", data.organizationId)
      .eq("active", true);

    // Az "always" hozzárendelés csak a munkatárs tényleges rendelkezésre állásának idejére
    // foglalja le az erőforrást — ezért kell az érintett munkatársak munkaidő/ablak adata is.
    const assignStaffIds = Array.from(new Set((assigns ?? []).map((a: any) => a.staff_profile_id).filter(Boolean)));
    const staffById = new Map<string, any>();
    (staffRows ?? []).forEach((s: any) => staffById.set(s.id, s));
    const missingIds = assignStaffIds.filter((id) => !staffById.has(id));
    if (missingIds.length > 0) {
      const { data: extra } = await admin
        .from("staff_profiles")
        .select("id, working_hours_json, availability_windows_json")
        .in("id", missingIds);
      (extra ?? []).forEach((s: any) => staffById.set(s.id, s));
    }

    const otherSvcIds = Array.from(new Set((bookings ?? []).map((b: any) => b.service_id).filter(Boolean)));
    const { data: otherSvcRes } = otherSvcIds.length > 0
      ? await admin.from("service_resources").select("service_id, resource_id, group_no").in("service_id", otherSvcIds)
      : { data: [] as any[] };
    const otherGroupsMap = groupResourceRows((otherSvcRes ?? []) as any);

    // Más szolgáltatások eszközigényei — a "biztosan használt eszközök" számításához más foglalások blokkolják az eszközt.
    // Az érintett erőforrások típusát is le kell kérdezni.
    const otherResourceIds = Array.from(new Set((otherSvcRes ?? []).map((r: any) => r.resource_id)));
    if (otherResourceIds.length > 0) {
      const missingTypeIds = otherResourceIds.filter((rid) => !resourceTypes.has(rid));
      if (missingTypeIds.length > 0) {
        const { data: extraTypes } = await admin
          .from("resources").select("id, type").in("id", missingTypeIds);
        for (const r of extraTypes ?? []) resourceTypes.set((r as any).id, (r as any).type);
      }
    }
    // serviceId → biztosan használt eszközök
    const equipmentUsedByService = new Map<string, Set<string>>();
    for (const sid of otherSvcIds) {
      const rows = (otherSvcRes ?? []).filter((r: any) => r.service_id === sid);
      const eg = extractEquipmentGroups(rows.map((r: any) => ({ resource_id: r.resource_id, group_no: r.group_no })), resourceTypes);
      equipmentUsedByService.set(sid, definitelyUsedEquipment(eg));
    }


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
              // OR-csoportos erőforrás-szabályok kapacitással: minden csoporthoz kell legalább egy szabad (usage<capacity) erőforrás.
              const usage = new Map<string, number>();
              for (const b of (bookings ?? [])) {
                if (b.staff_profile_id === s.id) continue;
                if (!overlaps({ start: slotStart, end: slotEnd }, { start: new Date(b.start_at), end: new Date(b.end_at) })) continue;
                definitelyConsumed({ resource_id: (b as any).resource_id ?? null, service_id: (b as any).service_id }, otherGroupsMap)
                  .forEach((rid) => bumpUsage(usage, rid));
                // Eszköz blokk: elsőként a konkrétan lefoglalt equipment_ids szerint,
                // legacy foglalásoknál (üres) a "biztosan használt" eszközökkel.
                const eqIds: string[] = Array.isArray((b as any).equipment_ids) ? (b as any).equipment_ids : [];
                if (eqIds.length > 0) {
                  for (const eid of eqIds) bumpUsage(usage, eid);
                } else {
                  const eqUsed = equipmentUsedByService.get((b as any).service_id);
                  if (eqUsed) for (const eid of eqUsed) bumpUsage(usage, eid);
                }
              }
              for (const a of (assigns ?? [])) {
                if (a.staff_profile_id === s.id) continue;
                if (assignmentBlocks(a, slotStart, slotEnd, tz, staffById.get(a.staff_profile_id))) bumpUsage(usage, a.resource_id);
              }
              const blocked = blockedFromUsage(usage, capacities);
              if (!allGroupsHaveFreeResource(ourGroups, blocked)) ok = false;

              // Eszköz-helyszín szabály: ha vannak eszközigények ÉS vannak helyszín-csoportok,
              // akkor minden helyszín-csoportban legalább egy olyan szabad helyszínnek kell lennie,
              // amely az összes szükséges eszközcsoporthoz tartozó egyik eszközt fizikailag tartalmazza.
              if (ok && equipmentGroups.length > 0 && locationGroups.length > 0) {
                const blockedEq = new Set<string>();
                for (const eid of allEquipmentIds) if (blocked.has(eid)) blockedEq.add(eid);
                for (const lg of locationGroups) {
                  const found = lg.some((lid) => !blocked.has(lid) && locationSupportsAllEquipmentGroups(lid, equipmentGroups, blockedEq, equipmentLocationsMap));
                  if (!found) { ok = false; break; }
                }
              }
            }

            if (!ok) continue;

            out.push({ iso: slotStart.toISOString(), staffProfileId: s.id });
          }
        }
      }
    }

    return { slots: out };
  });

function assignmentBlocks(a: any, start: Date, end: Date, tz: string, staff?: any): boolean {
  if (!a.active) return false;

  // "always" → csak akkor blokkol, ha a munkatárs ebben az intervallumban
  // ténylegesen rendelkezésre is áll (heti munkaidő ∩ rendelkezésre állási ablakok).
  if (a.kind === "always") {
    if (!staff) return false;
    return staffAvailableOverlap(staff, start, end, tz);
  }

  // "scheduled": ugyanaz a logika, mint a munkatárs rendelkezésre állásnál.
  // Heti minta (váltott műszak támogatással) + opcionális időablakok.
  const wh = a.working_hours_json ?? {};
  const wins: any[] = Array.isArray(a.availability_windows_json) ? a.availability_windows_json : [];
  const validWins = wins
    .filter((w) => w && typeof w.start === "string" && typeof w.end === "string")
    .map((w) => ({ start: new Date(w.start), end: new Date(w.end) }));
  const hasWeekly = wh && (
    wh.mode === "alternating"
      ? !!(wh.alt && Object.values(wh.alt).some((pat: any) => pat && Object.values(pat).some(Boolean)))
      : Object.values(wh).some(Boolean)
  );

  // Ha sem heti, sem ablak nincs → nincs tényleges lefoglalandó metszet.
  if (!hasWeekly && validWins.length === 0) return false;

  // Heti minta ÉS egyedi ablakok additívan (UNION) blokkolnak:
  // bármelyikkel egybeesik az [start,end), blokkolódik.
  if (hasWeekly) {
    // Egy nappal a start előtt kezdünk, hogy az előző napra konfigurált, éjfélen
    // átnyúló (overnight) munkaidő-tartományok is bekerüljenek a vizsgálatba.
    let cursor = addZonedDays(zonedStartOfDay(start, tz), -1, tz);
    while (cursor < end) {
      const zp = getZonedParts(cursor, tz);
      const ranges = dayRangesFromWeekly(wh, { year: zp.year, month: zp.month, day: zp.day, weekday: zp.weekday }, tz);
      for (const r of ranges) {
        if (start < r.end && end > r.start) return true;
      }
      cursor = addZonedDays(cursor, 1, tz);
    }
  }
  for (const w of validWins) {
    if (start < w.end && end > w.start) return true;
  }
  return false;
}

/** Igaz, ha a [start,end) intervallum bármilyen része egybeesik a munkatárs
 *  tényleges rendelkezésre állásával (heti munkaidő ∩ rendelkezésre állási ablakok). */
function staffAvailableOverlap(staff: any, start: Date, end: Date, tz: string): boolean {
  const wh = staff?.working_hours_json ?? {};
  const wins: any[] = Array.isArray(staff?.availability_windows_json) ? staff.availability_windows_json : [];
  const validWins = wins
    .filter((w) => w && typeof w.start === "string" && typeof w.end === "string")
    .map((w) => ({ start: new Date(w.start), end: new Date(w.end) }));
  const hasWeekly = wh && (
    wh.mode === "alternating"
      ? !!(wh.alt && Object.values(wh.alt).some((pat: any) => pat && Object.values(pat).some(Boolean)))
      : Object.values(wh).some(Boolean)
  );

  // Ha a munkatárs nem konfigurált sem heti munkaidőt, sem ablakot, nincs mit blokkolnia.
  if (!hasWeekly && validWins.length === 0) return false;

  // Heti minta ÉS egyedi ablakok additívan (UNION) számítanak rendelkezésre állásnak.
  if (hasWeekly) {
    let cursor = addZonedDays(zonedStartOfDay(start, tz), -1, tz);
    while (cursor < end) {
      const zp = getZonedParts(cursor, tz);
      const ranges = dayRangesFromWeekly(wh, { year: zp.year, month: zp.month, day: zp.day, weekday: zp.weekday }, tz);
      for (const r of ranges) {
        if (start < r.end && end > r.start) return true;
      }
      cursor = addZonedDays(cursor, 1, tz);
    }
  }
  for (const w of validWins) {
    if (start < w.end && end > w.start) return true;
  }
  return false;
}

