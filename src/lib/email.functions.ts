import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/lib/supabase-admin-loader";

let supabaseAdmin: Awaited<ReturnType<typeof getSupabaseAdmin>>;
async function ensureSupabaseAdmin() {
  supabaseAdmin ??= await getSupabaseAdmin();
}

const PROVIDERS = ["lovable_shared", "lovable_custom_domain", "resend"] as const;

async function assertOwner(userId: string, orgId: string) {
  await ensureSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("owner_id")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Üzlet nem található");
  if (data.owner_id !== userId) throw new Error("Csak az üzlet tulajdonosa szerkesztheti a beállításokat");
}

async function isAdmin(userId: string) {
  await ensureSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "platform_admin").maybeSingle();
  return !!data;
}

export const getOrgEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await isAdmin(context.userId);
    if (!admin) await assertOwner(context.userId, data.orgId);
    const { data: row, error } = await supabaseAdmin
      .from("organization_email_settings")
      .select("*")
      .eq("organization_id", data.orgId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Adminnak elrejtjük a Resend kulcsot
    if (row && admin && !await isOwnerOnly(context.userId, data.orgId)) {
      return { ...row, resend_api_key_secret_name: row.resend_api_key_secret_name ? "•••••••" : null };
    }
    return row;
  });

async function isOwnerOnly(userId: string, orgId: string) {
  await ensureSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("organizations").select("owner_id").eq("id", orgId).maybeSingle();
  return data?.owner_id === userId;
}

export const updateOrgEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    orgId: z.string().uuid(),
    sender_name: z.string().max(120).optional(),
    sender_email: z.string().email().nullable().optional(),
    reply_to: z.string().email().nullable().optional(),
    provider: z.enum(PROVIDERS).optional(),
    custom_domain: z.string().max(255).nullable().optional(),
    resend_api_key: z.string().max(255).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.userId, data.orgId);
    const patch: any = { organization_id: data.orgId, updated_at: new Date().toISOString() };
    for (const k of ["sender_name", "sender_email", "reply_to", "provider", "custom_domain"] as const) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    if (data.resend_api_key !== undefined) {
      patch.resend_api_key_secret_name = data.resend_api_key && data.resend_api_key !== "•••••••" ? data.resend_api_key : null;
    }
    const { error } = await supabaseAdmin
      .from("organization_email_settings")
      .upsert(patch, { onConflict: "organization_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Foglalási visszaigazoló e-mail küldés. Egyelőre csak naplózzuk és előkészítjük. */
export const sendBookingEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    bookingId: z.string().uuid(),
    templateKey: z.enum(["booking_confirmed", "booking_reminder", "booking_cancelled", "booking_rescheduled"]).default("booking_confirmed"),
  }).parse(d))
  .handler(async ({ data }) => {
    const { data: booking, error: bErr } = await supabaseAdmin
      .from("bookings")
      .select("id, organization_id, service_id, start_at, end_at, customer_id, customer_auth_user_id")
      .eq("id", data.bookingId)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!booking) throw new Error("Foglalás nem található");

    const [{ data: settings }, { data: tmpl }, { data: service }, { data: org }] = await Promise.all([
      supabaseAdmin.from("organization_email_settings").select("*").eq("organization_id", booking.organization_id).maybeSingle(),
      supabaseAdmin.from("notification_templates").select("*").eq("organization_id", booking.organization_id).eq("template_key", data.templateKey).eq("channel", "email").maybeSingle(),
      supabaseAdmin.from("services").select("name").eq("id", booking.service_id).maybeSingle(),
      supabaseAdmin.from("organizations").select("name, slug").eq("id", booking.organization_id).maybeSingle(),
    ]);

    // Címzett e-mail
    let recipient: string | null = null;
    if (booking.customer_id) {
      const { data: c } = await supabaseAdmin.from("customers").select("email").eq("id", booking.customer_id).maybeSingle();
      recipient = c?.email ?? null;
    }
    if (!recipient && booking.customer_auth_user_id) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(booking.customer_auth_user_id);
      recipient = u.user?.email ?? null;
    }

    const subject = tmpl?.subject ?? `Foglalás visszaigazolva – ${org?.name ?? ""}`;
    const body = (tmpl?.body ?? `Kedves Ügyfél!\n\nFoglalása megerősítve.\nSzolgáltatás: {{service}}\nIdőpont: {{date}}\nSzolgáltató: {{provider_name}}`)
      .replaceAll("{{service}}", service?.name ?? "")
      .replaceAll("{{date}}", new Date(booking.start_at).toLocaleString("hu-HU"))
      .replaceAll("{{provider_name}}", org?.name ?? "");

    await supabaseAdmin.from("notification_logs").insert({
      organization_id: booking.organization_id,
      booking_id: booking.id,
      channel: "email",
      template_key: data.templateKey,
      recipient,
      status: settings?.provider ? `prepared:${settings.provider}` : "prepared:lovable_shared",
      payload_json: { subject, body, sender_name: settings?.sender_name, sender_email: settings?.sender_email },
    });

    return { ok: true, recipient, subject };
  });
