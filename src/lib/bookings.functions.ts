import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Megnézi, hogy egy staff_resource_assignment átfedi-e a [start,end) időablakot. */
function assignmentOverlaps(a: any, start: Date, end: Date): boolean {
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
    // Iterate each day touched by [start, end)
    const d = new Date(start);
    d.setHours(0, 0, 0, 0);
    while (d < end) {
      const dayKey = DAY_KEYS[d.getDay()];
      const slots: [string, string][] | null = pat[dayKey] ?? null;
      if (slots && slots.length > 0) {
        for (const [hs, he] of slots) {
          const [sh, sm] = hs.split(":").map(Number);
          const [eh, em] = he.split(":").map(Number);
          const slotStart = new Date(d); slotStart.setHours(sh, sm, 0, 0);
          const slotEnd = new Date(d); slotEnd.setHours(eh, em, 0, 0);
          if (start < slotEnd && end > slotStart) return true;
        }
      }
      d.setDate(d.getDate() + 1);
    }
    return false;
  }
  return false;
}

/**
 * Ellenőrzi, hogy a [start,end) intervallum belefér-e az alkalmazott
 * heti munkaidejébe ÉS (ha van) a rendelkezésre állási időablakokba.
 */
async function assertStaffAvailable(staffProfileId: string, start: Date, end: Date) {
  const { data: s } = await supabaseAdmin
    .from("staff_profiles").select("working_hours_json, availability_windows_json")
    .eq("id", staffProfileId).single();
  if (!s) throw new Error("Munkatárs nem található");
  const pat: any = s.working_hours_json ?? {};
  const key = DAY_KEYS[start.getDay()];
  const v = pat?.[key];
  const ranges: [string, string][] = Array.isArray(v) && v.length === 2 && typeof v[0] === "string"
    ? [[v[0], v[1]]]
    : Array.isArray(v) ? (v as [string, string][]) : [];
  const inWorking = ranges.some(([hs, he]) => {
    const [sh, sm] = hs.split(":").map(Number);
    const [eh, em] = he.split(":").map(Number);
    const ws = new Date(start); ws.setHours(sh, sm, 0, 0);
    const we = new Date(start); we.setHours(eh, em, 0, 0);
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

  // 1) Az ÚJ foglalás által lefoglalt erőforrások: bookings.resource_id ∪ service_resources
  const required = new Set<string>();
  if (opts.resourceId) required.add(opts.resourceId);
  const { data: svcRes } = await admin
    .from("service_resources").select("resource_id").eq("service_id", opts.serviceId);
  svcRes?.forEach((r: any) => required.add(r.resource_id));
  if (required.size === 0) return;

  const reqList = Array.from(required);

  // 2) Más, már létező foglalások erőforrás-ütközése
  const bookingsQuery = admin
    .from("bookings")
    .select("id, resource_id, service_id")
    .eq("organization_id", opts.organizationId)
    .in("status", ["confirmed", "checked_in", "pending_payment"])
    .lt("start_at", end.toISOString())
    .gt("end_at", start.toISOString());
  if (opts.excludeBookingId) bookingsQuery.neq("id", opts.excludeBookingId);
  const { data: overlapping } = await bookingsQuery;
  if (overlapping && overlapping.length > 0) {
    const otherSvcIds = overlapping.map((b: any) => b.service_id).filter(Boolean);
    const { data: otherSvcRes } = otherSvcIds.length > 0
      ? await admin.from("service_resources").select("service_id, resource_id").in("service_id", otherSvcIds)
      : { data: [] as any[] };
    const svcResMap = new Map<string, string[]>();
    (otherSvcRes ?? []).forEach((r: any) => {
      const arr = svcResMap.get(r.service_id) ?? [];
      arr.push(r.resource_id);
      svcResMap.set(r.service_id, arr);
    });
    for (const b of overlapping) {
      const used = new Set<string>();
      if (b.resource_id) used.add(b.resource_id);
      (svcResMap.get(b.service_id) ?? []).forEach((r) => used.add(r));
      for (const rid of reqList) {
        if (used.has(rid)) {
          throw new Error("Ez az időpont már foglalt — egy szükséges erőforrás épp használatban van.");
        }
      }
    }
  }

  // 3) Más alkalmazott staff_resource_assignment-je
  const { data: assigns } = await admin
    .from("staff_resource_assignments")
    .select("*")
    .eq("organization_id", opts.organizationId)
    .in("resource_id", reqList)
    .eq("active", true);
  for (const a of assigns ?? []) {
    if (opts.staffProfileId && a.staff_profile_id === opts.staffProfileId) continue;
    if (assignmentOverlaps(a, start, end)) {
      throw new Error("Ez az erőforrás ebben az időszakban egy másik alkalmazotthoz van rendelve.");
    }
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

    const start = new Date(data.startAt);
    const end = new Date(start.getTime() + svc.duration_minutes * 60_000);

    // Conflict check: staff
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

    const start = new Date(data.startAt);
    const end = new Date(start.getTime() + svc.duration_minutes * 60_000);

    if (data.staffProfileId) {
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
      .select("*, services(duration_minutes, name), customers(email, full_name)")
      .eq("id", data.bookingId).single();
    if (bErr || !b) throw new Error("Foglalás nem található");
    const dur = (b.services as any)?.duration_minutes ?? 30;
    const start = new Date(data.startAt);
    const end = new Date(start.getTime() + dur * 60_000);

    // Staff ütközés
    if (b.staff_profile_id) {
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

