import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

    // Upsert customer
    const { data: existingCustomer } = await admin
      .from("customers")
      .select("id")
      .eq("organization_id", data.organizationId)
      .eq("auth_user_id", userId)
      .maybeSingle();

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

    await admin.from("notification_logs").insert({
      organization_id: data.organizationId,
      booking_id: booking.id,
      customer_id: customerId,
      channel: "email",
      template_key: "booking_confirmed",
      recipient: data.customerEmail,
      status: "mock_sent",
      payload_json: { start_at: start.toISOString(), service: svc.name },
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

    // Find existing guest customer by org+email (no auth_user_id)
    const { data: existing } = await admin
      .from("customers")
      .select("id")
      .eq("organization_id", data.organizationId)
      .is("auth_user_id", null)
      .eq("email", data.customerEmail)
      .maybeSingle();

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

    await admin.from("notification_logs").insert({
      organization_id: data.organizationId,
      booking_id: booking.id,
      customer_id: customerId,
      channel: "email",
      template_key: "booking_confirmed_guest",
      recipient: data.customerEmail,
      status: "mock_sent",
      payload_json: { start_at: start.toISOString(), service: svc.name },
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
