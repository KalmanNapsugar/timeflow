import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/lib/supabase-admin-loader";
import { getZonedParts, zonedTimeToUtc, zonedStartOfDay, addZonedDays, resolveBusinessTz, resolveDayPattern, dayRangesFromWeekly } from "@/lib/timezone";
import { groupResourceRows, definitelyConsumed, allGroupsHaveFreeResource, allResourcesInGroups, bumpUsage, blockedFromUsage } from "@/lib/resource-groups";
import { writeBookingAudit } from "@/lib/bookings.functions";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

let supabaseAdmin: Awaited<ReturnType<typeof getSupabaseAdmin>>;
async function ensureSupabaseAdmin() {
  supabaseAdmin ??= await getSupabaseAdmin();
}

const Input = z.object({
  organizationId: z.string().uuid(),
  serviceId: z.string().uuid(),
  staffProfileId: z.string().uuid().nullable(),
  startAt: z.string(),
  customerName: z.string().min(1).max(120),
  customerEmail: z.string().email().max(200).nullable(),
  customerPhone: z.string().max(30).nullable(),
  note: z.string().max(1000).nullable(),
  force: z.boolean().default(false),
});

async function assertOwnerOrMember(userId: string, organizationId: string) {
  await ensureSupabaseAdmin();
  const { data: org } = await supabaseAdmin
    .from("organizations").select("owner_id").eq("id", organizationId).single();
  if (org?.owner_id === userId) return "owner";
  const { data: mem } = await supabaseAdmin
    .from("organization_members").select("id")
    .eq("organization_id", organizationId).eq("user_id", userId).eq("active", true).maybeSingle();
  if (mem) return "member";
  throw new Error("Nincs jogosultságod foglalást rögzíteni ehhez az üzlethez.");
}

/** Felderíti az ütközéseket: nyitvatartás, foglalás-ütközés, erőforrás. */
async function detectWarnings(opts: {
  organizationId: string;
  serviceId: string;
  staffProfileId: string | null;
  start: Date;
  end: Date;
}): Promise<string[]> {
  await ensureSupabaseAdmin();
  const warnings: string[] = [];
  const admin = supabaseAdmin;

  const { data: org } = await admin
    .from("organizations").select("timezone, dst_enabled").eq("id", opts.organizationId).single();
  const tz = resolveBusinessTz(org?.timezone || "Europe/Budapest", org?.dst_enabled !== false);

  // Múltbéli
  if (opts.start.getTime() < Date.now() - 5 * 60_000) {
    warnings.push("Az időpont a múltban van.");
  }

  // Staff munkaidő + rendelkezésre állás + szolgáltatás-jogosultság
  if (opts.staffProfileId) {
    const { data: ss } = await admin
      .from("staff_services").select("staff_profile_id")
      .eq("service_id", opts.serviceId).eq("staff_profile_id", opts.staffProfileId).maybeSingle();
    if (!ss) warnings.push("A kiválasztott munkatárs nincs hozzárendelve ehhez a szolgáltatáshoz.");
    const { data: s } = await admin
      .from("staff_profiles")
      .select("display_name, working_hours_json, availability_windows_json")
      .eq("id", opts.staffProfileId).single();
    if (s) {
      const pat: any = s.working_hours_json ?? {};
      const zp = getZonedParts(opts.start, tz);
      const v = resolveDayPattern(pat, zp);
      const ranges: [string, string][] = Array.isArray(v) && v.length === 2 && typeof v[0] === "string"
        ? [[v[0], v[1]]]
        : Array.isArray(v) ? (v as [string, string][]) : [];
      const inWorking = ranges.some(([hs, he]) => {
        const [sh, sm] = hs.split(":").map(Number);
        const [eh, em] = he.split(":").map(Number);
        const ws = zonedTimeToUtc(zp.year, zp.month, zp.day, sh, sm || 0, tz);
        const we = zonedTimeToUtc(zp.year, zp.month, zp.day, eh, em || 0, tz);
        return opts.start >= ws && opts.end <= we;
      });
      if (!inWorking) warnings.push(`${s.display_name}: az időpont a heti munkaidőn kívül esik.`);

      const windows: any[] = Array.isArray(s.availability_windows_json) ? s.availability_windows_json as any[] : [];
      const validWindows = windows.filter((w) => w && typeof w.start === "string" && typeof w.end === "string");
      if (validWindows.length > 0) {
        const inWindow = validWindows.some((w) => {
          const ws = new Date(w.start), we = new Date(w.end);
          return opts.start >= ws && opts.end <= we;
        });
        if (!inWindow) warnings.push(`${s.display_name}: rendelkezésre állási ablakon kívül esik.`);
      }
    }

    // Staff foglalás-ütközés
    const { data: conflicts } = await admin
      .from("bookings")
      .select("id, start_at, services(name)")
      .eq("staff_profile_id", opts.staffProfileId)
      .in("status", ["confirmed", "checked_in", "pending_payment"])
      .lt("start_at", opts.end.toISOString())
      .gt("end_at", opts.start.toISOString());
    if (conflicts && conflicts.length > 0) {
      warnings.push(`Munkatárs ütközés: ${conflicts.length} másik foglalás fedi át az időpontot.`);
    }
  }

  // Erőforrás-ütközés
  const { data: svcRes } = await admin
    .from("service_resources").select("resource_id, group_no").eq("service_id", opts.serviceId);
  const ourGroupsMap = groupResourceRows(((svcRes ?? []) as any[]).map((r) => ({ service_id: opts.serviceId, resource_id: r.resource_id, group_no: r.group_no })));
  const ourGroups = ourGroupsMap.get(opts.serviceId) ?? [];
  if (ourGroups.length > 0) {
    const ourResourceIds = allResourcesInGroups(ourGroups);
    const capacities = new Map<string, number>();
    if (ourResourceIds.length > 0) {
      const { data: caps } = await admin
        .from("resources").select("id, capacity").in("id", ourResourceIds);
      for (const r of caps ?? []) capacities.set((r as any).id, (r as any).capacity ?? 1);
    }
    const { data: overlapping } = await admin
      .from("bookings")
      .select("id, resource_id, service_id")
      .eq("organization_id", opts.organizationId)
      .in("status", ["confirmed", "checked_in", "pending_payment"])
      .lt("start_at", opts.end.toISOString())
      .gt("end_at", opts.start.toISOString());
    const usage = new Map<string, number>();
    if (overlapping && overlapping.length > 0) {
      const otherIds = overlapping.map((b: any) => b.service_id).filter(Boolean);
      const { data: otherSvcRes } = otherIds.length > 0
        ? await admin.from("service_resources").select("service_id, resource_id, group_no").in("service_id", otherIds)
        : { data: [] as any[] };
      const otherGroupsMap = groupResourceRows((otherSvcRes ?? []) as any);
      for (const b of overlapping) {
        definitelyConsumed({ resource_id: (b as any).resource_id ?? null, service_id: (b as any).service_id }, otherGroupsMap)
          .forEach((rid) => bumpUsage(usage, rid));
      }
    }
    const blocked = blockedFromUsage(usage, capacities);
    if (!allGroupsHaveFreeResource(ourGroups, blocked)) {
      warnings.push("Erőforrás-ütközés: a szolgáltatás valamely követelmény-csoportjához nincs szabad erőforrás.");
    }
  }


  return warnings;
}

/** Csak ellenőrzés — nem rögzít. */
export const checkInternalBookingConflicts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnerOrMember(context.userId, data.organizationId);
    const { data: svc } = await supabaseAdmin
      .from("services").select("duration_minutes").eq("id", data.serviceId).single();
    if (!svc) throw new Error("Szolgáltatás nem található");
    const start = new Date(data.startAt);
    const end = new Date(start.getTime() + svc.duration_minutes * 60_000);
    const warnings = await detectWarnings({
      organizationId: data.organizationId,
      serviceId: data.serviceId,
      staffProfileId: data.staffProfileId,
      start, end,
    });
    return { warnings };
  });

/** Létrehoz egy belső foglalást. Ha force=false és van ütközés → hibát dob a listával. */
export const createInternalBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnerOrMember(context.userId, data.organizationId);
    const admin = supabaseAdmin;

    const { data: svc, error: svcErr } = await admin
      .from("services").select("*").eq("id", data.serviceId).single();
    if (svcErr || !svc) throw new Error("Szolgáltatás nem található");
    if (svc.organization_id !== data.organizationId) throw new Error("Hibás szervezet");

    const start = new Date(data.startAt);
    if (isNaN(start.getTime())) throw new Error("Érvénytelen időpont");
    const end = new Date(start.getTime() + svc.duration_minutes * 60_000);

    const warnings = await detectWarnings({
      organizationId: data.organizationId,
      serviceId: data.serviceId,
      staffProfileId: data.staffProfileId,
      start, end,
    });
    if (warnings.length > 0 && !data.force) {
      const items = warnings.map((m) => ({ kind: "other", message: m }));
      const err = new Error("CONFLICTS:" + JSON.stringify(items));
      (err as any).warnings = warnings;
      throw err;
    }

    // Ügyfél: emailre keresünk, ha van, különben név alapján; különben új
    let customerId: string | null = null;
    if (data.customerEmail) {
      const { data: existing } = await admin
        .from("customers").select("id")
        .eq("organization_id", data.organizationId)
        .eq("email", data.customerEmail).maybeSingle();
      customerId = existing?.id ?? null;
    }
    if (!customerId) {
      const { data: newCust, error: cErr } = await admin.from("customers").insert({
        organization_id: data.organizationId,
        full_name: data.customerName,
        email: data.customerEmail,
        phone: data.customerPhone,
      }).select("id").single();
      if (cErr) throw new Error(cErr.message);
      customerId = newCust!.id;
    }

    const { data: loc } = await admin
      .from("locations").select("id").eq("organization_id", data.organizationId).limit(1).maybeSingle();

    const { data: booking, error: bErr } = await admin.from("bookings").insert({
      organization_id: data.organizationId,
      location_id: loc?.id ?? null,
      customer_id: customerId,
      customer_auth_user_id: null,
      staff_profile_id: data.staffProfileId,
      service_id: data.serviceId,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status: "confirmed",
      price_total: svc.price,
      deposit_amount: svc.deposit_amount,
      payment_status: "none",
      source: "internal",
      note: data.note?.trim() || null,
    }).select("*").single();
    if (bErr) throw new Error(bErr.message);

    await writeBookingAudit({
      organizationId: data.organizationId,
      bookingId: booking.id,
      startAt: start,
      customerName: data.customerName,
      customerEmail: data.customerEmail ?? null,
      customerPhone: data.customerPhone ?? null,
      serviceId: svc.id,
      serviceName: svc.name,
      servicePrice: Number(svc.price ?? 0),
      prepaid: false,
      staffProfileId: data.staffProfileId,
    });

    return { bookingId: booking.id, warnings };
  });
