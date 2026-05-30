import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type Range = { start: Date; end: Date };

function parseHM(s: string): [number, number] {
  const [h, m] = s.split(":").map(Number);
  return [h, m || 0];
}

/** Heti minta -> az adott nap [start,end) intervallumai */
function dayRangesFromWeekly(pattern: any, day: Date): Range[] {
  const key = DAY_KEYS[day.getDay()];
  const v = pattern?.[key];
  if (!v) return [];
  // Két formátum: ["09:00","17:00"] (régi single-range) VAGY [["09:00","13:00"],["14:00","17:00"]]
  const ranges: [string, string][] =
    Array.isArray(v) && v.length === 2 && typeof v[0] === "string"
      ? [[v[0], v[1]]]
      : Array.isArray(v)
        ? (v as [string, string][])
        : [];
  return ranges.map(([hs, he]) => {
    const [sh, sm] = parseHM(hs);
    const [eh, em] = parseHM(he);
    const start = new Date(day); start.setHours(sh, sm, 0, 0);
    const end = new Date(day); end.setHours(eh, em, 0, 0);
    return { start, end };
  });
}

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

    const { data: svc } = await admin
      .from("services").select("*").eq("id", data.serviceId).single();
    if (!svc) throw new Error("Szolgáltatás nem található");
    const dur = svc.duration_minutes;

    // Eligible staff (akik végzik a szolgáltatást)
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

    const from = new Date(data.fromISO);
    from.setHours(0, 0, 0, 0);
    const until = new Date(from); until.setDate(until.getDate() + data.days);

    // Foglalások az időszakban (érintett staff-okra)
    const staffIds = staff.map((s: any) => s.id);
    const { data: bookings } = await admin
      .from("bookings")
      .select("staff_profile_id, start_at, end_at, service_id, resource_id")
      .eq("organization_id", data.organizationId)
      .in("status", ["confirmed", "checked_in", "pending_payment"])
      .lt("start_at", until.toISOString())
      .gt("end_at", from.toISOString());

    // Service required resources (az ÚJ foglalás által igényelt)
    const { data: svcRes } = await admin
      .from("service_resources").select("resource_id").eq("service_id", data.serviceId);
    const requiredResources = new Set<string>((svcRes ?? []).map((r: any) => r.resource_id));

    // Staff-resource hozzárendelések (más alkalmazott blokkolhatja az erőforrást)
    const { data: assigns } = await admin
      .from("staff_resource_assignments")
      .select("*")
      .eq("organization_id", data.organizationId)
      .eq("active", true);

    // Map: foglalás -> mely erőforrásokat foglal le (saját + service_resources)
    const otherSvcIds = Array.from(new Set((bookings ?? []).map((b: any) => b.service_id).filter(Boolean)));
    const { data: otherSvcRes } = otherSvcIds.length > 0
      ? await admin.from("service_resources").select("service_id, resource_id").in("service_id", otherSvcIds)
      : { data: [] as any[] };
    const svcResMap = new Map<string, string[]>();
    (otherSvcRes ?? []).forEach((r: any) => {
      const arr = svcResMap.get(r.service_id) ?? [];
      arr.push(r.resource_id);
      svcResMap.set(r.service_id, arr);
    });

    const now = new Date();
    const minStart = new Date(now.getTime() + 30 * 60_000); // legalább 30 perccel a jelen után

    type Slot = { iso: string; staffProfileId: string };
    const out: Slot[] = [];

    for (const s of staff) {
      const working = s.working_hours_json ?? {};
      const windows: { start: string; end: string }[] = Array.isArray(s.availability_windows_json)
        ? s.availability_windows_json
        : [];
      const windowRanges: Range[] = windows.map((w) => ({ start: new Date(w.start), end: new Date(w.end) }));

      const myBookings = (bookings ?? []).filter((b: any) => b.staff_profile_id === s.id);

      for (let d = 0; d < data.days; d++) {
        const day = new Date(from); day.setDate(day.getDate() + d);
        let ranges = dayRangesFromWeekly(working, day);
        if (ranges.length === 0) continue;
        if (windowRanges.length > 0) {
          ranges = intersectRanges(ranges, windowRanges);
        }

        for (const r of ranges) {
          const stepMs = dur * 60_000;
          for (let t = r.start.getTime(); t + stepMs <= r.end.getTime(); t += stepMs) {
            const slotStart = new Date(t);
            const slotEnd = new Date(t + stepMs);
            if (slotStart < minStart) continue;

            // Ütközés saját foglalásokkal
            let ok = true;
            for (const b of myBookings) {
              if (overlaps({ start: slotStart, end: slotEnd }, { start: new Date(b.start_at), end: new Date(b.end_at) })) {
                ok = false; break;
              }
            }
            if (!ok) continue;

            // Erőforrás-ütközés más foglalásokkal
            if (requiredResources.size > 0) {
              for (const b of (bookings ?? [])) {
                if (b.staff_profile_id === s.id) continue; // saját foglalás már levonva
                if (!overlaps({ start: slotStart, end: slotEnd }, { start: new Date(b.start_at), end: new Date(b.end_at) })) continue;
                const used = new Set<string>();
                if (b.resource_id) used.add(b.resource_id);
                (svcResMap.get(b.service_id) ?? []).forEach((rid) => used.add(rid));
                for (const need of requiredResources) {
                  if (used.has(need)) { ok = false; break; }
                }
                if (!ok) break;
              }
            }
            if (!ok) continue;

            // Más alkalmazott staff_resource_assignment-je az igényelt erőforrásra
            if (requiredResources.size > 0) {
              for (const a of (assigns ?? [])) {
                if (a.staff_profile_id === s.id) continue;
                if (!requiredResources.has(a.resource_id)) continue;
                if (assignmentBlocks(a, slotStart, slotEnd)) { ok = false; break; }
              }
            }
            if (!ok) continue;

            out.push({ iso: slotStart.toISOString(), staffProfileId: s.id });
          }
        }
      }
    }

    // Dedupe iso (különböző staff azonos időben megengedett — a kliens választhat)
    return { slots: out };
  });

function assignmentBlocks(a: any, start: Date, end: Date): boolean {
  if (!a.active) return false;
  if (a.kind === "always") return true;
  if (a.kind === "window") {
    const s = a.starts_at ? new Date(a.starts_at) : null;
    const e = a.ends_at ? new Date(a.ends_at) : null;
    if (s && end <= s) return false;
    if (e && start >= e) return false;
    return true;
  }
  if (a.kind === "weekly") {
    const pat = a.weekly_pattern_json ?? {};
    const d = new Date(start); d.setHours(0, 0, 0, 0);
    while (d < end) {
      const key = DAY_KEYS[d.getDay()];
      const slots: [string, string][] | null = pat[key] ?? null;
      if (slots && slots.length > 0) {
        for (const [hs, he] of slots) {
          const [sh, sm] = parseHM(hs);
          const [eh, em] = parseHM(he);
          const ss = new Date(d); ss.setHours(sh, sm, 0, 0);
          const ee = new Date(d); ee.setHours(eh, em, 0, 0);
          if (start < ee && end > ss) return true;
        }
      }
      d.setDate(d.getDate() + 1);
    }
    return false;
  }
  return false;
}
