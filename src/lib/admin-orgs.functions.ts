import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles").select("role")
    .eq("user_id", userId).eq("role", "platform_admin").maybeSingle();
  if (!data) throw new Error("Csak platform admin");
}

// Tables that belong to one organization (used for export/import + delete).
const ORG_TABLES = [
  "locations",
  "service_categories",
  "services",
  "service_packages",
  "service_package_items_via_packages", // handled specially below
  "service_resources_via_services",     // handled specially below
  "staff_services_via_services",        // handled specially below
  "resources",
  "staff_profiles",
  "organization_members",
  "customers",
  "intake_forms",
  "intake_questions_via_forms",         // handled specially
  "bookings",
  "intake_answers_via_bookings",        // handled specially
  "payments_via_bookings",              // handled specially
  "booking_locks",
  "inventory_items",
  "inventory_movements",
  "coupons",
  "vouchers",
  "notification_templates",
  "notification_logs",
  "organization_email_settings",
  "reviews",
  "audit_logs",
  "staff_invitations",
] as const;

export const archiveOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("organizations")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", data.orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unarchiveOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("organizations")
      .update({ archived_at: null })
      .eq("id", data.orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    orgId: z.string().uuid(),
    confirmName: z.string().min(1).max(200),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: org, error: e1 } = await supabaseAdmin
      .from("organizations").select("name").eq("id", data.orgId).single();
    if (e1 || !org) throw new Error("Üzlet nem található");
    if (org.name.trim() !== data.confirmName.trim()) {
      throw new Error("A megadott név nem egyezik az üzlet nevével");
    }
    const { error } = await supabaseAdmin.rpc("delete_organization_cascade", { _org_id: data.orgId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const exportOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const orgId = data.orgId;

    const fetchOrg = async <T = unknown>(table: string) =>
      (await supabaseAdmin.from(table).select("*").eq("organization_id", orgId)).data as T[] ?? [];

    const fetchIn = async <T = unknown>(table: string, col: string, ids: string[]) =>
      ids.length
        ? ((await supabaseAdmin.from(table).select("*").in(col, ids)).data as T[]) ?? []
        : [];

    const { data: organization, error: orgErr } = await supabaseAdmin
      .from("organizations").select("*").eq("id", orgId).single();
    if (orgErr || !organization) throw new Error("Üzlet nem található");

    const [
      locations, service_categories, services, service_packages, resources,
      staff_profiles, organization_members, customers, intake_forms, bookings,
      booking_locks, inventory_items, inventory_movements, coupons, vouchers,
      notification_templates, notification_logs, organization_email_settings,
      reviews, audit_logs, staff_invitations,
    ] = await Promise.all([
      fetchOrg("locations"), fetchOrg("service_categories"), fetchOrg("services"),
      fetchOrg("service_packages"), fetchOrg("resources"), fetchOrg("staff_profiles"),
      fetchOrg("organization_members"), fetchOrg("customers"), fetchOrg("intake_forms"),
      fetchOrg("bookings"), fetchOrg("booking_locks"), fetchOrg("inventory_items"),
      fetchOrg("inventory_movements"), fetchOrg("coupons"), fetchOrg("vouchers"),
      fetchOrg("notification_templates"), fetchOrg("notification_logs"),
      fetchOrg("organization_email_settings"), fetchOrg("reviews"),
      fetchOrg("audit_logs"), fetchOrg("staff_invitations"),
    ]);

    const serviceIds = (services as Array<{ id: string }>).map(s => s.id);
    const packageIds = (service_packages as Array<{ id: string }>).map(p => p.id);
    const formIds = (intake_forms as Array<{ id: string }>).map(f => f.id);
    const bookingIds = (bookings as Array<{ id: string }>).map(b => b.id);

    const [service_resources, staff_services, service_package_items, intake_questions, intake_answers, payments] = await Promise.all([
      fetchIn("service_resources", "service_id", serviceIds),
      fetchIn("staff_services", "service_id", serviceIds),
      fetchIn("service_package_items", "package_id", packageIds),
      fetchIn("intake_questions", "form_id", formIds),
      fetchIn("intake_answers", "booking_id", bookingIds),
      fetchIn("payments", "booking_id", bookingIds),
    ]);

    return {
      schema_version: 1,
      exported_at: new Date().toISOString(),
      organization,
      tables: {
        locations, service_categories, services, service_packages, service_package_items,
        service_resources, staff_services, resources, staff_profiles, organization_members,
        customers, intake_forms, intake_questions, bookings, intake_answers, payments,
        booking_locks, inventory_items, inventory_movements, coupons, vouchers,
        notification_templates, notification_logs, organization_email_settings,
        reviews, audit_logs, staff_invitations,
      },
    };
  });

const ImportSchema = z.object({
  schema_version: z.number(),
  organization: z.record(z.string(), z.unknown()),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

// Insertion order respects rough dependency chain
const IMPORT_ORDER = [
  "locations",
  "service_categories",
  "services",
  "service_packages",
  "service_package_items",
  "service_resources",
  "resources",
  "staff_profiles",
  "staff_services",
  "organization_members",
  "customers",
  "intake_forms",
  "intake_questions",
  "bookings",
  "intake_answers",
  "payments",
  "booking_locks",
  "inventory_items",
  "inventory_movements",
  "coupons",
  "vouchers",
  "notification_templates",
  "notification_logs",
  "organization_email_settings",
  "reviews",
  "audit_logs",
  "staff_invitations",
] as const;

export const importOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ImportSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const org = data.organization as Record<string, unknown> & { id?: string; slug?: string; name?: string };
    if (!org.id || !org.slug || !org.name) throw new Error("Hibás export fájl: hiányzó üzlet adatok");

    // Conflict check
    const { data: existing } = await supabaseAdmin
      .from("organizations").select("id").eq("id", org.id as string).maybeSingle();
    if (existing) throw new Error("Ez az üzlet már létezik (azonos ID). Előbb töröld.");

    const { data: slugExists } = await supabaseAdmin
      .from("organizations").select("id").eq("slug", org.slug as string).maybeSingle();
    if (slugExists) throw new Error(`A "${org.slug}" slug már foglalt`);

    // Insert organization (force archived state)
    const orgRow = { ...org, archived_at: new Date().toISOString() };
    const { error: orgErr } = await supabaseAdmin.from("organizations").insert(orgRow);
    if (orgErr) throw new Error(`Üzlet visszaállítása sikertelen: ${orgErr.message}`);

    const errors: string[] = [];
    for (const table of IMPORT_ORDER) {
      const rows = data.tables[table];
      if (!rows || rows.length === 0) continue;
      const { error } = await supabaseAdmin.from(table).insert(rows);
      if (error) errors.push(`${table}: ${error.message}`);
    }

    return {
      ok: true,
      orgId: org.id as string,
      warnings: errors,
    };
  });
