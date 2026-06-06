import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/lib/supabase-admin-loader";
import {
  getZonedParts,
  zonedTimeToUtc,
  resolveBusinessTz,
  resolveDayPattern,
} from "@/lib/timezone";
import type { ConflictItem } from "@/components/ConflictDialog";

const Input = z.object({
  organizationId: z.string().uuid(),
  scope: z.enum(["staff_hours", "assignment", "service", "booking_range"]),
  staffProfileId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  /** Csak `staff_hours` scope-nál: az új munkaidő/ablakok (még nincs mentve). */
  draftStaff: z
    .object({
      working_hours_json: z.any().optional(),
      availability_windows_json: z.array(z.any()).optional(),
    })
    .optional(),
  /** Csak `service` scope-nál: az új szolgáltatás-paraméterek. */
  draftService: z
    .object({
      duration_minutes: z.number().optional(),
    })
    .optional(),
  /** Csak `booking_range` scope-nál: napi sáv ellenőrzéséhez (naptár jelölés). */
  rangeFromIso: z.string().optional(),
  rangeToIso: z.string().optional(),
});

type DraftStaff = z.infer<typeof Input>["draftStaff"];

let supabaseAdmin: Awaited<ReturnType<typeof getSupabaseAdmin>>;
async function ensureSupabaseAdmin() {
  supabaseAdmin ??= await getSupabaseAdmin();
}

async function assertOwnerOrMember(userId: string, organizationId: string) {
  await ensureSupabaseAdmin();
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("owner_id")
    .eq("id", organizationId)
    .single();
  if (org?.owner_id === userId) return;
  const { data: mem } = await supabaseAdmin
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (!mem) throw new Error("Nincs jogosultságod.");
}

function isInWorkingHours(
  start: Date,
  end: Date,
  workingHoursJson: any,
  availabilityWindowsJson: any[] | null | undefined,
  tz: string,
): boolean {
  const pat: any = workingHoursJson ?? {};
  const zp = getZonedParts(start, tz);
  const v = resolveDayPattern(pat, zp);
  const ranges: [string, string][] =
    Array.isArray(v) && v.length === 2 && typeof v[0] === "string"
      ? [[v[0] as string, v[1] as string]]
      : Array.isArray(v)
      ? (v as [string, string][])
      : [];
  const inWeekly = ranges.some(([hs, he]) => {
    const [sh, sm] = hs.split(":").map(Number);
    const [eh, em] = he.split(":").map(Number);
    const ws = zonedTimeToUtc(zp.year, zp.month, zp.day, sh, sm || 0, tz);
    const we = zonedTimeToUtc(zp.year, zp.month, zp.day, eh, em || 0, tz);
    return start >= ws && end <= we;
  });

  const windows = Array.isArray(availabilityWindowsJson) ? availabilityWindowsJson : [];
  const validWindows = windows.filter(
    (w: any) => w && typeof w.start === "string" && typeof w.end === "string",
  );
  if (validWindows.length > 0) {
    return validWindows.some((w: any) => {
      const ws = new Date(w.start);
      const we = new Date(w.end);
      return start >= ws && end <= we;
    });
  }
  return inWeekly;
}

export const detectAffectedBookings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    await ensureSupabaseAdmin();
    await assertOwnerOrMember(context.userId, data.organizationId);
    const admin = supabaseAdmin;
    const conflicts: ConflictItem[] = [];

    const { data: org } = await admin
      .from("organizations")
      .select("timezone, dst_enabled")
      .eq("id", data.organizationId)
      .single();
    const tz = resolveBusinessTz(org?.timezone || "Europe/Budapest", org?.dst_enabled !== false);

    const nowIso = new Date().toISOString();

    // ---------- 1. staff_hours: új munkaidő/ablakok → mely jövőbeni foglalások esnek kívülre? ----------
    if (data.scope === "staff_hours" && data.staffProfileId) {
      const draft: DraftStaff = data.draftStaff;
      const { data: staff } = await admin
        .from("staff_profiles")
        .select("display_name, working_hours_json, availability_windows_json")
        .eq("id", data.staffProfileId)
        .single();
      if (!staff) return { conflicts: [] };

      const newWh = draft?.working_hours_json ?? staff.working_hours_json;
      const newWins = draft?.availability_windows_json ?? staff.availability_windows_json;
      const staffName = staff.display_name;

      const { data: bks } = await admin
        .from("bookings")
        .select("id, start_at, end_at, services(name), customers(full_name)")
        .eq("staff_profile_id", data.staffProfileId)
        .eq("organization_id", data.organizationId)
        .in("status", ["confirmed", "checked_in", "pending_payment"])
        .gte("start_at", nowIso);

      for (const b of bks ?? []) {
        const s = new Date((b as any).start_at);
        const e = new Date((b as any).end_at);
        if (!isInWorkingHours(s, e, newWh, newWins as any[], tz)) {
          conflicts.push({
            kind: "out_of_hours",
            message: `${staffName}: az új munkaidőn kívül esik.`,
            bookingId: (b as any).id,
            when: (b as any).start_at,
            who: (b as any).customers?.full_name ?? undefined,
            what: (b as any).services?.name ?? undefined,
          });
        }
      }
      return { conflicts };
    }

    // ---------- 2. assignment: a staff jövőbeni foglalásai → van-e érvényes erőforrás-hozzárendelés? ----------
    if (data.scope === "assignment" && data.staffProfileId) {
      const { data: assigns } = await admin
        .from("staff_resource_assignments")
        .select("resource_id, active, starts_at, ends_at")
        .eq("staff_profile_id", data.staffProfileId)
        .eq("active", true);
      const activeResIds = new Set<string>(
        (assigns ?? []).map((a: any) => a.resource_id).filter(Boolean),
      );

      const { data: bks } = await admin
        .from("bookings")
        .select(
          "id, start_at, end_at, resource_id, services(name), customers(full_name), staff_profiles(display_name)",
        )
        .eq("staff_profile_id", data.staffProfileId)
        .eq("organization_id", data.organizationId)
        .in("status", ["confirmed", "checked_in", "pending_payment"])
        .gte("start_at", nowIso);

      for (const b of bks ?? []) {
        const rid = (b as any).resource_id;
        if (rid && !activeResIds.has(rid)) {
          conflicts.push({
            kind: "missing_assignment",
            message: `${(b as any).staff_profiles?.display_name ?? "Munkatárs"}: nincs hozzárendelve ehhez az erőforráshoz.`,
            bookingId: (b as any).id,
            when: (b as any).start_at,
            who: (b as any).customers?.full_name ?? undefined,
            what: (b as any).services?.name ?? undefined,
          });
        }
      }
      return { conflicts };
    }

    // ---------- 3. service: új időtartam/erőforrásigény → érintett jövőbeni foglalások staff-/erőforrás-ütközése ----------
    if (data.scope === "service" && data.serviceId) {
      const { data: svc } = await admin
        .from("services")
        .select("name, duration_minutes")
        .eq("id", data.serviceId)
        .single();
      if (!svc) return { conflicts: [] };
      const newDur = data.draftService?.duration_minutes ?? svc.duration_minutes;

      const { data: bks } = await admin
        .from("bookings")
        .select(
          "id, start_at, end_at, staff_profile_id, resource_id, organization_id, services(name), customers(full_name), staff_profiles(display_name)",
        )
        .eq("service_id", data.serviceId)
        .eq("organization_id", data.organizationId)
        .in("status", ["confirmed", "checked_in", "pending_payment"])
        .gte("start_at", nowIso);

      for (const b of bks ?? []) {
        const s = new Date((b as any).start_at);
        const newEnd = new Date(s.getTime() + newDur * 60_000);
        if ((b as any).staff_profile_id) {
          const { data: ovl } = await admin
            .from("bookings")
            .select("id")
            .eq("staff_profile_id", (b as any).staff_profile_id)
            .in("status", ["confirmed", "checked_in", "pending_payment"])
            .neq("id", (b as any).id)
            .lt("start_at", newEnd.toISOString())
            .gt("end_at", s.toISOString());
          if (ovl && ovl.length > 0) {
            conflicts.push({
              kind: "staff_overlap",
              message: `Az új időtartammal a foglalás ütközik egy másikkal a munkatársnál.`,
              bookingId: (b as any).id,
              when: (b as any).start_at,
              who: (b as any).customers?.full_name ?? undefined,
              what: (b as any).services?.name ?? svc.name,
            });
          }
        }
      }
      return { conflicts };
    }

    // ---------- 4. booking_range: napsávban már létező ütközések kijelölése (naptár jelölőhöz) ----------
    if (data.scope === "booking_range" && data.rangeFromIso && data.rangeToIso) {
      const { data: bks } = await admin
        .from("bookings")
        .select("id, start_at, end_at, staff_profile_id, resource_id, services(name), customers(full_name)")
        .eq("organization_id", data.organizationId)
        .in("status", ["confirmed", "checked_in", "pending_payment"])
        .gte("start_at", data.rangeFromIso)
        .lt("start_at", data.rangeToIso);

      const list = (bks ?? []) as any[];
      // staff ütközés
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (!a.staff_profile_id || a.staff_profile_id !== b.staff_profile_id) continue;
          const aS = new Date(a.start_at).getTime(), aE = new Date(a.end_at).getTime();
          const bS = new Date(b.start_at).getTime(), bE = new Date(b.end_at).getTime();
          if (aS < bE && bS < aE) {
            for (const bk of [a, b]) {
              conflicts.push({
                kind: "staff_overlap",
                message: "Ugyanaz a munkatárs két átfedő foglaláson.",
                bookingId: bk.id,
                when: bk.start_at,
                who: bk.customers?.full_name ?? undefined,
                what: bk.services?.name ?? undefined,
              });
            }
          }
        }
      }
      return { conflicts };
    }

    return { conflicts };
  });
