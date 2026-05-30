import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as XLSX from "xlsx";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertOwnerOrMember(userId: string, orgId: string) {
  const { data: org } = await supabaseAdmin
    .from("organizations").select("owner_id").eq("id", orgId).single();
  if (org?.owner_id === userId) return "owner";
  const { data: mem } = await supabaseAdmin
    .from("organization_members").select("id")
    .eq("organization_id", orgId).eq("user_id", userId).eq("active", true).maybeSingle();
  if (mem) return "member";
  const { data: roles } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId);
  if ((roles ?? []).some((r: any) => r.role === "platform_admin")) return "admin";
  throw new Error("Nincs jogosultságod ehhez az üzlethez.");
}

function sheetToBase64(rows: any[], sheetName: string): string {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  return buf as string;
}

const OrgInput = z.object({ organizationId: z.string().uuid() });

export const exportServicesXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => OrgInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnerOrMember(context.userId, data.organizationId);
    const { data: svc } = await supabaseAdmin
      .from("services")
      .select("name, description, duration_minutes, price, deposit_amount, deposit_required, active, tags, created_at")
      .eq("organization_id", data.organizationId)
      .order("name");
    const rows = (svc ?? []).map((s: any) => ({
      "Név": s.name,
      "Leírás": s.description ?? "",
      "Időtartam (perc)": s.duration_minutes,
      "Ár (Ft)": Number(s.price),
      "Foglaló (Ft)": Number(s.deposit_amount),
      "Foglaló kötelező": s.deposit_required ? "Igen" : "Nem",
      "Aktív": s.active ? "Igen" : "Nem",
      "Címkék": Array.isArray(s.tags) ? s.tags.join(", ") : "",
      "Létrehozva": s.created_at,
    }));
    return { base64: sheetToBase64(rows, "Szolgáltatások"), filename: `szolgaltatasok-${new Date().toISOString().slice(0,10)}.xlsx` };
  });

export const exportStaffXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => OrgInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnerOrMember(context.userId, data.organizationId);
    const { data: staff } = await supabaseAdmin
      .from("staff_profiles")
      .select("display_name, bio, active, working_hours_json, created_at")
      .eq("organization_id", data.organizationId)
      .order("display_name");
    const rows = (staff ?? []).map((s: any) => ({
      "Név": s.display_name,
      "Bemutatkozás": s.bio ?? "",
      "Aktív": s.active ? "Igen" : "Nem",
      "Heti munkaidő": JSON.stringify(s.working_hours_json ?? {}),
      "Létrehozva": s.created_at,
    }));
    return { base64: sheetToBase64(rows, "Alkalmazottak"), filename: `alkalmazottak-${new Date().toISOString().slice(0,10)}.xlsx` };
  });

export const exportResourcesXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => OrgInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnerOrMember(context.userId, data.organizationId);
    const { data: res } = await supabaseAdmin
      .from("resources")
      .select("name, type, active, created_at")
      .eq("organization_id", data.organizationId)
      .order("name");
    const rows = (res ?? []).map((r: any) => ({
      "Név": r.name,
      "Típus": r.type,
      "Aktív": r.active ? "Igen" : "Nem",
      "Létrehozva": r.created_at,
    }));
    return { base64: sheetToBase64(rows, "Erőforrások"), filename: `eroforrasok-${new Date().toISOString().slice(0,10)}.xlsx` };
  });

const BookingsExportInput = OrgInput.extend({
  fromISO: z.string().optional(),
  toISO: z.string().optional(),
});

export const exportBookingsXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => BookingsExportInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnerOrMember(context.userId, data.organizationId);
    let q = supabaseAdmin
      .from("booking_audit")
      .select("*")
      .eq("organization_id", data.organizationId)
      .order("start_at", { ascending: false });
    if (data.fromISO) q = q.gte("start_at", data.fromISO);
    if (data.toISO) q = q.lte("start_at", data.toISO);
    const { data: rows } = await q;
    const out = (rows ?? []).map((r: any) => ({
      "Üzlet neve": r.organization_name,
      "Foglalás időpontja (mikor foglalt)": new Date(r.booked_at).toLocaleString("hu-HU"),
      "Vendég neve": r.customer_name,
      "Befoglalt időpont": new Date(r.start_at).toLocaleString("hu-HU"),
      "Vendég telefonszáma": r.customer_phone ?? "",
      "Vendég email címe": r.customer_email ?? "",
      "Új vendég?": r.is_new_customer ? "Igen" : "Nem",
      "Szolgáltatás": r.service_name,
      "Szolgáltatás ára": Number(r.service_price),
      "Előre fizetett?": r.prepaid ? "Igen" : "Nem",
      "Kezelő (alkalmazott)": r.staff_name ?? "",
      "Megjegyzés": r.note ?? "",
      "Megjegyzés látható vendégnek": r.note_visible_to_customer ? "Igen" : "Nem",
    }));
    return { base64: sheetToBase64(out, "Foglalások"), filename: `foglalasok-${new Date().toISOString().slice(0,10)}.xlsx` };
  });
