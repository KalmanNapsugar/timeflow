import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getZonedParts, zonedStartOfDay, zonedTimeToUtc, addZonedDays, resolveBusinessTz, classifyLocalTime, resolveDayPattern } from "@/lib/timezone";
import { groupResourceRows, definitelyConsumed, allGroupsHaveFreeResource, allResourcesInGroups, bumpUsage, blockedFromUsage } from "@/lib/resource-groups";

/** Beír egy strukturált foglalás-audit rekordot. Csendben elnyel hibákat — a foglalást nem akadhatja meg. */
export async function writeBookingAudit(opts: {
  organizationId: string;
  bookingId: string;
  startAt: Date;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  serviceId: string;
  serviceName: string;
  servicePrice: number;
  prepaid: boolean;
  staffProfileId: string | null;
}) {
  try {
    const admin = supabaseAdmin;
    const [{ data: org }, { data: staff }] = await Promise.all([
      admin.from("organizations").select("name").eq("id", opts.organizationId).single(),
      opts.staffProfileId
        ? admin.from("staff_profiles").select("display_name").eq("id", opts.staffProfileId).single()
        : Promise.resolve({ data: null as any }),
    ]);
    // "Új vendég" = nincs korábbi audit-rekord ennél a szervezetnél azonos e-maillel vagy telefonnal
    let isNew = true;
    const orFilter: string[] = [];
    if (opts.customerEmail) orFilter.push(`customer_email.eq.${opts.customerEmail}`);
    if (opts.customerPhone) orFilter.push(`customer_phone.eq.${opts.customerPhone}`);
    if (orFilter.length > 0) {
      const { data: prior } = await admin
        .from("booking_audit")
        .select("id")
        .eq("organization_id", opts.organizationId)
        .neq("booking_id", opts.bookingId)
        .or(orFilter.join(","))
        .limit(1);
      if (prior && prior.length > 0) isNew = false;
    }
    await admin.from("booking_audit").insert({
      organization_id: opts.organizationId,
      booking_id: opts.bookingId,
      start_at: opts.startAt.toISOString(),
      organization_name: org?.name ?? "",
      customer_name: opts.customerName,
      customer_email: opts.customerEmail,
      customer_phone: opts.customerPhone,
      is_new_customer: isNew,
      service_id: opts.serviceId,
      service_name: opts.serviceName,
      service_price: opts.servicePrice,
      prepaid: opts.prepaid,
      staff_profile_id: opts.staffProfileId,
      staff_name: staff?.display_name ?? null,
    });
  } catch (e) {
    console.error("[booking_audit] insert failed:", e);
  }
}


const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

async function getOrgTimezone(organizationId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("organizations").select("timezone, dst_enabled").eq("id", organizationId).single();
  return resolveBusinessTz(data?.timezone || "Europe/Budapest", data?.dst_enabled !== false);
}

/**
 * Ellenőrzi, hogy a [start,end) intervallum értelmes-e az üzlet időzónájában:
 *  - nem a múltban van
 *  - end > start
 *  - a kezdés (és a vég) nem esik DST "kieső" időszakra (pl. tavasszal 02:30)
 */
async function assertBookingTimeSane(organizationId: string, start: Date, end: Date) {
  if (!(start instanceof Date) || isNaN(start.getTime())) throw new Error("Érvénytelen kezdési időpont.");
  if (end <= start) throw new Error("A foglalás vége korábbi vagy egyenlő a kezdéssel.");
  // 5 perc türelem az óra-szinkronizációs eltérésekre
  if (start.getTime() < Date.now() - 5 * 60_000) {
    throw new Error("Múltbéli időpontra nem lehet foglalni.");
  }
  const tz = await getOrgTimezone(organizationId);
  const ps = getZonedParts(start, tz);
  const pe = getZonedParts(end, tz);
  const sCls = classifyLocalTime(ps.year, ps.month, ps.day, ps.hour, ps.minute, tz);
  if (sCls === "gap") {
    throw new Error("A választott időpont a nyári időszámítás-váltás miatt nem létezik ebben az időzónában. Válassz másik időpontot.");
  }
  const eCls = classifyLocalTime(pe.year, pe.month, pe.day, pe.hour, pe.minute, tz);
  if (eCls === "gap") {
    throw new Error("A foglalás vége a nyári időszámítás-váltás miatti kieső időszakra esik. Válassz másik időpontot.");
  }
}

/** Megnézi, hogy egy staff_resource_assignment átfedi-e a [start,end) időablakot — az üzlet zónájában. */
function assignmentOverlaps(a: any, start: Date, end: Date, tz: string): boolean {
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
    let cursor = zonedStartOfDay(start, tz);
    while (cursor < end) {
      const zp = getZonedParts(cursor, tz);
      const dayKey = DAY_KEYS[zp.weekday];
      const slots: [string, string][] | null = pat[dayKey] ?? null;
      if (slots && slots.length > 0) {
        for (const [hs, he] of slots) {
          const [sh, sm] = hs.split(":").map(Number);
          const [eh, em] = he.split(":").map(Number);
          const slotStart = zonedTimeToUtc(zp.year, zp.month, zp.day, sh, sm || 0, tz);
          const slotEnd = zonedTimeToUtc(zp.year, zp.month, zp.day, eh, em || 0, tz);
          if (start < slotEnd && end > slotStart) return true;
        }
      }
      cursor = addZonedDays(cursor, 1, tz);
    }
    return false;
  }
  return false;
}

/**
 * Ellenőrzi, hogy a [start,end) intervallum belefér-e az alkalmazott
 * heti munkaidejébe ÉS (ha van) a rendelkezésre állási időablakokba — az üzlet időzónájában.
 */
async function assertStaffAvailable(staffProfileId: string, start: Date, end: Date) {
  const { data: s } = await supabaseAdmin
    .from("staff_profiles")
    .select("working_hours_json, availability_windows_json, organization_id")
    .eq("id", staffProfileId).single();
  if (!s) throw new Error("Munkatárs nem található");
  const tz = await getOrgTimezone(s.organization_id);
  const pat: any = s.working_hours_json ?? {};
  const zp = getZonedParts(start, tz);
  const v = resolveDayPattern(pat, zp);
  const ranges: [string, string][] = Array.isArray(v) && v.length === 2 && typeof v[0] === "string"
    ? [[v[0], v[1]]]
    : Array.isArray(v) ? (v as [string, string][]) : [];
  const inWorking = ranges.some(([hs, he]) => {
    const [sh, sm] = hs.split(":").map(Number);
    const [eh, em] = he.split(":").map(Number);
    const ws = zonedTimeToUtc(zp.year, zp.month, zp.day, sh, sm || 0, tz);
    const we = zonedTimeToUtc(zp.year, zp.month, zp.day, eh, em || 0, tz);
    return start >= ws && end <= we;
  });
  if (!inWorking) throw new Error("Ez az időpont a munkatárs munkaidején kívül esik.");
  const windows: any[] = Array.isArray(s.availability_windows_json) ? s.availability_windows_json as any[] : [];
  const validWindows = windows.filter((w) => w && typeof w.start === "string" && typeof w.end === "string");
  if (validWindows.length > 0) {
    const inWindow = validWindows.some((w) => {
      const ws = new Date(w.start), we = new Date(w.end);
      return start >= ws && end <= we;
    });
    if (!inWindow) throw new Error("Ez az időpont a munkatárs rendelkezésre állási ablakain kívül esik.");
  }
}

/**
 * Ellenőrzi az "előre bejelentkezés minimum" időkorlátot (#3).
 * - Lead time = max(service.min_lead_time_minutes, staff.min_lead_time_minutes)
 * - Ha staff.allow_instant_after_booking és az alkalmazottnak az adott (üzleti-zóna) napon
 *   van legalább egy confirmed/checked_in/pending_payment foglalása, ami a most foglalandó
 *   időpont ELŐTT van → lead time 0-ra csökken arra a napra.
 * Dob hibát, ha a slot túl közel van.
 */
async function assertLeadTime(opts: {
  organizationId: string;
  staffProfileId: string | null;
  serviceMinLead: number;
  start: Date;
  excludeBookingId?: string;
}) {
  let lead = opts.serviceMinLead ?? 0;
  let allowInstant = false;
  if (opts.staffProfileId) {
    const { data: s } = await supabaseAdmin
      .from("staff_profiles")
      .select("min_lead_time_minutes, allow_instant_after_booking")
      .eq("id", opts.staffProfileId).single();
    if (s) {
      lead = Math.max(lead, s.min_lead_time_minutes ?? 0);
      allowInstant = !!s.allow_instant_after_booking;
    }
  }
  if (lead <= 0) return;

  if (allowInstant && opts.staffProfileId) {
    const tz = await getOrgTimezone(opts.organizationId);
    const dayStart = zonedStartOfDay(opts.start, tz);
    const dayEnd = addZonedDays(dayStart, 1, tz);
    const q = supabaseAdmin
      .from("bookings")
      .select("id, start_at")
      .eq("staff_profile_id", opts.staffProfileId)
      .in("status", ["confirmed", "checked_in", "pending_payment"])
      .gte("start_at", dayStart.toISOString())
      .lt("start_at", dayEnd.toISOString())
      .lt("start_at", opts.start.toISOString());
    if (opts.excludeBookingId) q.neq("id", opts.excludeBookingId);
    const { data: earlier } = await q.limit(1);
    if (earlier && earlier.length > 0) return; // azonnali engedélyezve
  }

  const minStart = Date.now() + lead * 60_000;
  if (opts.start.getTime() < minStart) {
    throw new Error(`Erre az időpontra már nem lehet bejelentkezni — legalább ${lead} perccel előre kell foglalni.`);
  }
}

/**
 * Ellenőrzi:
 *  (a) van-e másik foglalás, ami ugyanazt az erőforrást foglalja a [start,end) intervallumban
 *  (b) lefoglalta-e MÁSIK alkalmazott ezt az erőforrást staff_resource_assignment-tel
 * Dob hibát, ha ütközés van.
 */
async function checkResourceConflicts(opts: {
  organizationId: string;
  serviceId: string;
  staffProfileId: string | null;
  resourceId: string | null;
  startISO: string;
  endISO: string;
  excludeBookingId?: string;
}) {
  const admin = supabaseAdmin;
  const start = new Date(opts.startISO);
  const end = new Date(opts.endISO);

  // 1) A szolgáltatás erőforrás-csoportjai (OR a csoporton belül, AND a csoportok között).
  const { data: svcRes } = await admin
    .from("service_resources").select("resource_id, group_no").eq("service_id", opts.serviceId);
  const ourGroupsMap = groupResourceRows(((svcRes ?? []) as any[]).map((r) => ({ service_id: opts.serviceId, resource_id: r.resource_id, group_no: r.group_no })));
  const ourGroups = ourGroupsMap.get(opts.serviceId) ?? [];
  // Ha a hívó konkrét resource_id-t adott meg, biztosítsuk, hogy az foglalt legyen → egyelemű csoportként kezeljük.
  if (opts.resourceId) ourGroups.push([opts.resourceId]);
  if (ourGroups.length === 0) return;

  const ourResourceIds = allResourcesInGroups(ourGroups);

  // Kapacitások betöltése (alap 1 / erőforrás)
  const capacities = new Map<string, number>();
  if (ourResourceIds.length > 0) {
    const { data: caps } = await admin
      .from("resources").select("id, capacity").in("id", ourResourceIds);
    for (const r of caps ?? []) capacities.set((r as any).id, (r as any).capacity ?? 1);
  }

  // 2) Más, már létező foglalások erőforrás-használata
  const bookingsQuery = admin
    .from("bookings")
    .select("id, resource_id, service_id")
    .eq("organization_id", opts.organizationId)
    .in("status", ["confirmed", "checked_in", "pending_payment"])
    .lt("start_at", end.toISOString())
    .gt("end_at", start.toISOString());
  if (opts.excludeBookingId) bookingsQuery.neq("id", opts.excludeBookingId);
  const { data: overlapping } = await bookingsQuery;

  const usage = new Map<string, number>();
  if (overlapping && overlapping.length > 0) {
    const otherSvcIds = overlapping.map((b: any) => b.service_id).filter(Boolean);
    const { data: otherSvcRes } = otherSvcIds.length > 0
      ? await admin.from("service_resources").select("service_id, resource_id, group_no").in("service_id", otherSvcIds)
      : { data: [] as any[] };
    const otherGroupsMap = groupResourceRows((otherSvcRes ?? []) as any);
    for (const b of overlapping) {
      definitelyConsumed({ resource_id: (b as any).resource_id ?? null, service_id: (b as any).service_id }, otherGroupsMap)
        .forEach((rid) => bumpUsage(usage, rid));
    }
  }

  // 3) Más alkalmazott staff_resource_assignment-je az általunk releváns erőforrásokra
  if (ourResourceIds.length > 0) {
    const { data: assigns } = await admin
      .from("staff_resource_assignments")
      .select("*")
      .eq("organization_id", opts.organizationId)
      .in("resource_id", ourResourceIds)
      .eq("active", true);
    const tz = assigns && assigns.length > 0 ? await getOrgTimezone(opts.organizationId) : "UTC";
    for (const a of assigns ?? []) {
      if (opts.staffProfileId && a.staff_profile_id === opts.staffProfileId) continue;
      if (assignmentOverlaps(a, start, end, tz)) bumpUsage(usage, a.resource_id);
    }
  }

  const blocked = blockedFromUsage(usage, capacities);
  if (!allGroupsHaveFreeResource(ourGroups, blocked)) {
    throw new Error("Ez az időpont nem foglalható: nincs szabad erőforrás a szolgáltatás minden követelményéhez.");
  }
}



const BookingInput = z.object({
  organizationId: z.string().uuid(),
  serviceId: z.string().uuid(),
  staffProfileId: z.string().uuid().nullable(),
  startAt: z.string(),
  customerName: z.string().min(1).max(120),
  customerEmail: z.string().email().max(200),
  customerPhone: z.string().min(3).max(30),
  policyAccepted: z.literal(true),
  mockDepositPaid: z.boolean(),
});

export const createBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => BookingInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const admin = supabaseAdmin;

    const { data: svc, error: svcErr } = await admin
      .from("services").select("*").eq("id", data.serviceId).single();
    if (svcErr || !svc) throw new Error("Szolgáltatás nem található");
    if (svc.organization_id !== data.organizationId) throw new Error("Hibás szervezet");

    if ((svc as any).staff_only) {
      const { data: org } = await admin.from("organizations").select("owner_id").eq("id", data.organizationId).single();
      const isOwner = org?.owner_id === userId;
      let isMember = false;
      if (!isOwner) {
        const { data: mem } = await admin.from("organization_members")
          .select("id").eq("organization_id", data.organizationId).eq("user_id", userId).eq("active", true).maybeSingle();
        isMember = !!mem;
      }
      let isAdmin = false;
      if (!isOwner && !isMember) {
        const { data: roleRow } = await admin.from("user_roles")
          .select("role").eq("user_id", userId).eq("role", "platform_admin").maybeSingle();
        isAdmin = !!roleRow;
      }
      if (!isOwner && !isMember && !isAdmin) {
        throw new Error("Ez a szolgáltatás nem foglalható.");
      }
    }

    const start = new Date(data.startAt);
    const end = new Date(start.getTime() + svc.duration_minutes * 60_000);
    await assertBookingTimeSane(data.organizationId, start, end);

    // Conflict check: staff
    if (data.staffProfileId) {
      // Csak a szolgáltatáshoz kipipált munkatársak végezhetik
      const { data: ss } = await admin
        .from("staff_services").select("staff_profile_id")
        .eq("service_id", data.serviceId).eq("staff_profile_id", data.staffProfileId).maybeSingle();
      if (!ss) throw new Error("A kiválasztott munkatárs nem végzi ezt a szolgáltatást.");

      await assertStaffAvailable(data.staffProfileId, start, end);
      const { data: conflicts } = await admin
        .from("bookings")
        .select("id")
        .eq("staff_profile_id", data.staffProfileId)
        .in("status", ["confirmed", "checked_in", "pending_payment"])
        .lt("start_at", end.toISOString())
        .gt("end_at", start.toISOString());
      if (conflicts && conflicts.length > 0) {
        throw new Error("Ez az időpont már foglalt ennél a munkatársnál.");
      }
    } else {
      // Ha nincs konkrét munkatárs választva, legyen legalább egy, aki végzi
      const { data: ss } = await admin
        .from("staff_services").select("staff_profile_id").eq("service_id", data.serviceId).limit(1);
      if (!ss || ss.length === 0) throw new Error("Ehhez a szolgáltatáshoz nincs munkatárs rendelve.");
    }

    // Erőforrás-ütközés
    await checkResourceConflicts({
      organizationId: data.organizationId,
      serviceId: data.serviceId,
      staffProfileId: data.staffProfileId,
      resourceId: null,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
    });

    // #3: minimum előre-bejelentkezési idő
    await assertLeadTime({
      organizationId: data.organizationId,
      staffProfileId: data.staffProfileId,
      serviceMinLead: (svc as any).min_lead_time_minutes ?? 0,
      start,
    });

    // Upsert customer
    const { data: existingCustomer } = await admin
      .from("customers")
      .select("id, requires_deposit_override")

      .eq("organization_id", data.organizationId)
      .eq("auth_user_id", userId)
      .maybeSingle();

    // "Csak előre fizetéssel" ügyfélnél kötelező a sikeres online fizetés
    const prepayOnly = !!existingCustomer?.requires_deposit_override;
    if (prepayOnly && !data.mockDepositPaid) {
      throw new Error("Ez az ügyfél csak sikeres online fizetéssel foglalhat időpontot.");
    }

    let customerId = existingCustomer?.id;
    if (!customerId) {
      const { data: newCust, error: cErr } = await admin.from("customers").insert({
        organization_id: data.organizationId,
        auth_user_id: userId,
        full_name: data.customerName,
        email: data.customerEmail,
        phone: data.customerPhone,
        gdpr_consent_at: new Date().toISOString(),
      }).select("id").single();
      if (cErr) throw new Error(cErr.message);
      customerId = newCust!.id;
    }

    const { data: loc } = await admin
      .from("locations").select("id").eq("organization_id", data.organizationId).limit(1).single();

    const { data: booking, error: bErr } = await admin.from("bookings").insert({
      organization_id: data.organizationId,
      location_id: loc?.id ?? null,
      customer_id: customerId,
      customer_auth_user_id: userId,
      staff_profile_id: data.staffProfileId,
      service_id: data.serviceId,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status: "confirmed",
      price_total: svc.price,
      deposit_amount: svc.deposit_amount,
      payment_status: data.mockDepositPaid ? "mock_paid" : "none",
      source: "web",
    }).select("*").single();
    if (bErr) throw new Error(bErr.message);

    if (data.mockDepositPaid && svc.deposit_amount > 0) {
      await admin.from("payments").insert({
        booking_id: booking.id,
        provider: "mock",
        amount: svc.deposit_amount,
        currency: "HUF",
        status: "mock_paid",
        paid_at: new Date().toISOString(),
      });
    }

    // Értesítő csak akkor megy ki, ha nem prepay-only, VAGY ha prepay-only és a fizetés sikeres volt.
    if (!prepayOnly || data.mockDepositPaid) {
      await admin.from("notification_logs").insert({
        organization_id: data.organizationId,
        booking_id: booking.id,
        customer_id: customerId,
        channel: "email",
        template_key: "booking_confirmed",
        recipient: data.customerEmail,
        status: "mock_sent",
        payload_json: { start_at: start.toISOString(), service: svc.name, prepaid: data.mockDepositPaid },
      });
    }

    await writeBookingAudit({
      organizationId: data.organizationId,
      bookingId: booking.id,
      startAt: start,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone,
      serviceId: svc.id,
      serviceName: svc.name,
      servicePrice: Number(svc.price ?? 0),
      prepaid: !!data.mockDepositPaid,
      staffProfileId: data.staffProfileId,
    });

    return { bookingId: booking.id };
  });


const GuestBookingInput = BookingInput.extend({
  // Honeypot field – real users leave it empty; bots tend to fill it.
  hp: z.string().max(0).optional(),
});

export const createGuestBooking = createServerFn({ method: "POST" })
  .inputValidator((d) => GuestBookingInput.parse(d))
  .handler(async ({ data }) => {
    const admin = supabaseAdmin;

    const { data: svc, error: svcErr } = await admin
      .from("services").select("*").eq("id", data.serviceId).single();
    if (svcErr || !svc) throw new Error("Szolgáltatás nem található");
    if (svc.organization_id !== data.organizationId) throw new Error("Hibás szervezet");
    if ((svc as any).staff_only) throw new Error("Ez a szolgáltatás nem foglalható.");

    const start = new Date(data.startAt);
    const end = new Date(start.getTime() + svc.duration_minutes * 60_000);
    await assertBookingTimeSane(data.organizationId, start, end);

    if (data.staffProfileId) {
      await assertStaffAvailable(data.staffProfileId, start, end);
      const { data: conflicts } = await admin
        .from("bookings")
        .select("id")
        .eq("staff_profile_id", data.staffProfileId)
        .in("status", ["confirmed", "checked_in", "pending_payment"])
        .lt("start_at", end.toISOString())
        .gt("end_at", start.toISOString());
      if (conflicts && conflicts.length > 0) {
        throw new Error("Ez az időpont már foglalt ennél a munkatársnál.");
      }
    }

    // Erőforrás-ütközés
    await checkResourceConflicts({
      organizationId: data.organizationId,
      serviceId: data.serviceId,
      staffProfileId: data.staffProfileId,
      resourceId: null,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
    });

    // #3: minimum előre-bejelentkezési idő
    await assertLeadTime({
      organizationId: data.organizationId,
      staffProfileId: data.staffProfileId,
      serviceMinLead: (svc as any).min_lead_time_minutes ?? 0,
      start,
    });




    // Find existing guest customer by org+email (no auth_user_id)
    const { data: existing } = await admin
      .from("customers")
      .select("id, requires_deposit_override")
      .eq("organization_id", data.organizationId)
      .is("auth_user_id", null)
      .eq("email", data.customerEmail)
      .maybeSingle();

    const prepayOnly = !!existing?.requires_deposit_override;
    if (prepayOnly && !data.mockDepositPaid) {
      throw new Error("Ez az ügyfél csak sikeres online fizetéssel foglalhat időpontot.");
    }

    let customerId = existing?.id;
    if (!customerId) {
      const { data: newCust, error: cErr } = await admin.from("customers").insert({
        organization_id: data.organizationId,
        auth_user_id: null,
        full_name: data.customerName,
        email: data.customerEmail,
        phone: data.customerPhone,
        gdpr_consent_at: new Date().toISOString(),
      }).select("id").single();
      if (cErr) throw new Error(cErr.message);
      customerId = newCust!.id;
    }

    const { data: loc } = await admin
      .from("locations").select("id").eq("organization_id", data.organizationId).limit(1).single();

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
      payment_status: data.mockDepositPaid ? "mock_paid" : "none",
      source: "web_guest",
    }).select("*").single();
    if (bErr) throw new Error(bErr.message);

    if (data.mockDepositPaid && svc.deposit_amount > 0) {
      await admin.from("payments").insert({
        booking_id: booking.id,
        provider: "mock",
        amount: svc.deposit_amount,
        currency: "HUF",
        status: "mock_paid",
        paid_at: new Date().toISOString(),
      });
    }

    if (!prepayOnly || data.mockDepositPaid) {
      await admin.from("notification_logs").insert({
        organization_id: data.organizationId,
        booking_id: booking.id,
        customer_id: customerId,
        channel: "email",
        template_key: "booking_confirmed_guest",
        recipient: data.customerEmail,
        status: "mock_sent",
        payload_json: { start_at: start.toISOString(), service: svc.name, prepaid: data.mockDepositPaid },
      });
    }

    await writeBookingAudit({
      organizationId: data.organizationId,
      bookingId: booking.id,
      startAt: start,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone,
      serviceId: svc.id,
      serviceName: svc.name,
      servicePrice: Number(svc.price ?? 0),
      prepaid: !!data.mockDepositPaid,
      staffProfileId: data.staffProfileId,
    });

    return { bookingId: booking.id };
  });


const CancelInput = z.object({ bookingId: z.string().uuid(), reason: z.string().max(500).optional() });
export const cancelBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CancelInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled_by_guest", cancellation_reason: data.reason ?? null })
      .eq("id", data.bookingId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateTimeInput = z.object({
  bookingId: z.string().uuid(),
  startAt: z.string(),
});
export const updateBookingTime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateTimeInput.parse(d))
  .handler(async ({ data }) => {
    const admin = supabaseAdmin;
    const { data: b, error: bErr } = await admin
      .from("bookings")
      .select("*, services(duration_minutes, name, min_lead_time_minutes), customers(email, full_name)")
      .eq("id", data.bookingId).single();
    if (bErr || !b) throw new Error("Foglalás nem található");
    const dur = (b.services as any)?.duration_minutes ?? 30;
    const start = new Date(data.startAt);
    const end = new Date(start.getTime() + dur * 60_000);
    await assertBookingTimeSane(b.organization_id, start, end);

    // Staff ütközés és rendelkezésre állás
    if (b.staff_profile_id) {
      await assertStaffAvailable(b.staff_profile_id, start, end);
      const { data: conflicts } = await admin
        .from("bookings").select("id")
        .eq("staff_profile_id", b.staff_profile_id)
        .in("status", ["confirmed", "checked_in", "pending_payment"])
        .neq("id", b.id)
        .lt("start_at", end.toISOString())
        .gt("end_at", start.toISOString());
      if (conflicts && conflicts.length > 0) throw new Error("Ütközés ennél a munkatársnál.");
    }
    await checkResourceConflicts({
      organizationId: b.organization_id,
      serviceId: b.service_id,
      staffProfileId: b.staff_profile_id,
      resourceId: b.resource_id,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      excludeBookingId: b.id,
    });

    await assertLeadTime({
      organizationId: b.organization_id,
      staffProfileId: b.staff_profile_id,
      serviceMinLead: (b.services as any)?.min_lead_time_minutes ?? 0,
      start,
      excludeBookingId: b.id,
    });

    const { error: uErr } = await admin
      .from("bookings")
      .update({ start_at: start.toISOString(), end_at: end.toISOString() })
      .eq("id", b.id);
    if (uErr) throw new Error(uErr.message);

    const email = (b.customers as any)?.email;
    if (email) {
      await admin.from("notification_logs").insert({
        organization_id: b.organization_id,
        booking_id: b.id,
        customer_id: b.customer_id,
        channel: "email",
        template_key: "booking_rescheduled",
        recipient: email,
        status: "mock_sent",
        payload_json: {
          service: (b.services as any)?.name,
          old_start: b.start_at,
          new_start: start.toISOString(),
        },
      });
    }
    return { ok: true };
  });

export const cancelBookingAsStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    bookingId: z.string().uuid(),
    reason: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const admin = supabaseAdmin;
    const { data: b } = await admin
      .from("bookings")
      .select("*, services(name), customers(email, full_name)")
      .eq("id", data.bookingId).single();
    if (!b) throw new Error("Foglalás nem található");
    const { error } = await admin
      .from("bookings")
      .update({ status: "cancelled_by_provider", cancellation_reason: data.reason ?? null })
      .eq("id", data.bookingId);
    if (error) throw new Error(error.message);

    const email = (b.customers as any)?.email;
    if (email) {
      await admin.from("notification_logs").insert({
        organization_id: b.organization_id,
        booking_id: b.id,
        customer_id: b.customer_id,
        channel: "email",
        template_key: "booking_cancelled_by_provider",
        recipient: email,
        status: "mock_sent",
        payload_json: {
          service: (b.services as any)?.name,
          start_at: b.start_at,
          reason: data.reason ?? null,
        },
      });
    }
    return { ok: true };
  });

const UpdateNoteInput = z.object({
  bookingId: z.string().uuid(),
  note: z.string().max(2000).nullable(),
  noteVisibleToCustomer: z.boolean(),
});
export const updateBookingNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateNoteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const admin = supabaseAdmin;
    const { data: b } = await admin
      .from("bookings").select("organization_id, staff_profile_id").eq("id", data.bookingId).single();
    if (!b) throw new Error("Foglalás nem található");

    // Jogosultság: üzlet tulajdonosa VAGY szervezeti tag
    const { data: org } = await admin
      .from("organizations").select("owner_id").eq("id", b.organization_id).single();
    let allowed = org?.owner_id === userId;
    if (!allowed) {
      const { data: mem } = await admin
        .from("organization_members").select("id")
        .eq("organization_id", b.organization_id).eq("user_id", userId).eq("active", true).maybeSingle();
      allowed = !!mem;
    }
    if (!allowed) throw new Error("Nincs jogosultságod a megjegyzés szerkesztéséhez.");

    const noteVal = data.note?.trim() ? data.note.trim() : null;
    const { error } = await admin
      .from("bookings")
      .update({ note: noteVal, note_visible_to_customer: data.noteVisibleToCustomer })
      .eq("id", data.bookingId);
    if (error) throw new Error(error.message);

    // Szinkronizáljuk a legfrissebb audit-rekordba is (export miatt)
    const { data: auditRow } = await admin
      .from("booking_audit")
      .select("id")
      .eq("booking_id", data.bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (auditRow) {
      await admin.from("booking_audit")
        .update({ note: noteVal, note_visible_to_customer: data.noteVisibleToCustomer })
        .eq("id", auditRow.id);
    }
    return { ok: true };
  });


const UpdatePaymentStatusInput = z.object({
  bookingId: z.string().uuid(),
  paymentStatus: z.enum(["none", "mock_paid", "paid"]),
});
export const updateBookingPaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdatePaymentStatusInput.parse(d))
  .handler(async ({ data, context }) => {
    const admin = supabaseAdmin;
    const { data: b } = await admin
      .from("bookings").select("organization_id").eq("id", data.bookingId).single();
    if (!b) throw new Error("Foglalás nem található");
    const { data: org } = await admin
      .from("organizations").select("owner_id").eq("id", b.organization_id).single();
    if (org?.owner_id !== context.userId) {
      throw new Error("Csak az üzlet tulajdonosa módosíthatja a fizetési státuszt.");
    }
    const { error } = await admin
      .from("bookings")
      .update({ payment_status: data.paymentStatus })
      .eq("id", data.bookingId);
    if (error) throw new Error(error.message);
    // audit szinkronizálás
    const prepaid = data.paymentStatus !== "none";
    const { data: auditRow } = await admin
      .from("booking_audit").select("id").eq("booking_id", data.bookingId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (auditRow) {
      await admin.from("booking_audit").update({ prepaid }).eq("id", auditRow.id);
    }
    return { ok: true };
  });
