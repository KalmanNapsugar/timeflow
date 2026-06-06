import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/lib/supabase-admin-loader";

const Input = z.object({
  organizationId: z.string().uuid(),
  fromISO: z.string().optional(),
  toISO: z.string().optional(),
  staffProfileId: z.string().uuid().nullable().optional(),
  serviceId: z.string().uuid().nullable().optional(),
  onlyPrepaid: z.boolean().optional(),
  onlyNewCustomers: z.boolean().optional(),
});

export const listBookingAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    // jogosultság-ellenőrzés egyszerűen: owner vagy member
    const { data: org } = await supabaseAdmin
      .from("organizations").select("owner_id").eq("id", data.organizationId).single();
    if (org?.owner_id !== context.userId) {
      const { data: mem } = await supabaseAdmin
        .from("organization_members").select("id")
        .eq("organization_id", data.organizationId).eq("user_id", context.userId).eq("active", true).maybeSingle();
      if (!mem) {
        const { data: roles } = await supabaseAdmin
          .from("user_roles").select("role").eq("user_id", context.userId);
        if (!(roles ?? []).some((r: any) => r.role === "platform_admin")) {
          throw new Error("Nincs jogosultságod ehhez az üzlethez.");
        }
      }
    }

    let q = supabaseAdmin
      .from("booking_audit")
      .select("*")
      .eq("organization_id", data.organizationId)
      .order("start_at", { ascending: false })
      .limit(5000);
    if (data.fromISO) q = q.gte("start_at", data.fromISO);
    if (data.toISO) q = q.lte("start_at", data.toISO);
    if (data.staffProfileId) q = q.eq("staff_profile_id", data.staffProfileId);
    if (data.serviceId) q = q.eq("service_id", data.serviceId);
    if (data.onlyPrepaid) q = q.eq("prepaid", true);
    if (data.onlyNewCustomers) q = q.eq("is_new_customer", true);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });
