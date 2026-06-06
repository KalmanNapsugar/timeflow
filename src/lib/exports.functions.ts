import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as XLSX from "xlsx";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/lib/supabase-admin-loader";

let supabaseAdmin: Awaited<ReturnType<typeof getSupabaseAdmin>>;
async function ensureSupabaseAdmin() {
  supabaseAdmin ??= await getSupabaseAdmin();
}

async function assertOwnerOrMember(userId: string, orgId: string) {
  await ensureSupabaseAdmin();
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

async function assertOwner(userId: string, orgId: string) {
  await ensureSupabaseAdmin();
  const { data: org } = await supabaseAdmin
    .from("organizations").select("owner_id").eq("id", orgId).single();
  if (org?.owner_id === userId) return;
  const { data: roles } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId);
  if ((roles ?? []).some((r: any) => r.role === "platform_admin")) return;
  throw new Error("Csak az üzlet tulajdonosa importálhat.");
}

function sheetToBase64(rows: any[], sheetName: string): string {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  return buf as string;
}

function splitList(v: any): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

function parseBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "igen" || s === "yes" || s === "true" || s === "1" || s === "x";
}

const OrgInput = z.object({ organizationId: z.string().uuid() });

// ============ EXPORTS ============

export const exportServicesXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => OrgInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnerOrMember(context.userId, data.organizationId);
    const orgId = data.organizationId;
    const [{ data: svc }, { data: ss }, { data: sr }, { data: staff }, { data: res }] = await Promise.all([
      supabaseAdmin.from("services")
        .select("id, name, description, duration_minutes, price, deposit_amount, deposit_required, active, tags, created_at")
        .eq("organization_id", orgId).order("name"),
      supabaseAdmin.from("staff_services").select("service_id, staff_profile_id"),
      supabaseAdmin.from("service_resources").select("service_id, resource_id"),
      supabaseAdmin.from("staff_profiles").select("id, display_name").eq("organization_id", orgId),
      supabaseAdmin.from("resources").select("id, name").eq("organization_id", orgId),
    ]);
    const staffMap = new Map((staff ?? []).map((x: any) => [x.id, x.display_name]));
    const resMap = new Map((res ?? []).map((x: any) => [x.id, x.name]));
    const byStaff = new Map<string, string[]>();
    for (const r of ss ?? []) {
      const n = staffMap.get(r.staff_profile_id); if (!n) continue;
      if (!byStaff.has(r.service_id)) byStaff.set(r.service_id, []);
      byStaff.get(r.service_id)!.push(n);
    }
    const byRes = new Map<string, string[]>();
    for (const r of sr ?? []) {
      const n = resMap.get(r.resource_id); if (!n) continue;
      if (!byRes.has(r.service_id)) byRes.set(r.service_id, []);
      byRes.get(r.service_id)!.push(n);
    }
    const rows = (svc ?? []).map((s: any) => ({
      "Név": s.name,
      "Leírás": s.description ?? "",
      "Időtartam (perc)": s.duration_minutes,
      "Ár (Ft)": Number(s.price),
      "Foglaló (Ft)": Number(s.deposit_amount),
      "Foglaló kötelező": s.deposit_required ? "Igen" : "Nem",
      "Aktív": s.active ? "Igen" : "Nem",
      "Létrehozva": s.created_at,
      "Munkatársak": (byStaff.get(s.id) ?? []).join(", "),
      "Erőforrások": (byRes.get(s.id) ?? []).join(", "),
      "Címkék": Array.isArray(s.tags) ? s.tags.join(", ") : "",
    }));
    return { base64: sheetToBase64(rows, "Szolgáltatások"), filename: `szolgaltatasok-${new Date().toISOString().slice(0,10)}.xlsx` };
  });

export const exportStaffXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => OrgInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnerOrMember(context.userId, data.organizationId);
    const orgId = data.organizationId;
    const [{ data: staff }, { data: svc }, { data: ss }, { data: sra }, { data: res }] = await Promise.all([
      supabaseAdmin.from("staff_profiles")
        .select("id, display_name, bio, active, working_hours_json, created_at")
        .eq("organization_id", orgId).order("display_name"),
      supabaseAdmin.from("services").select("id, name").eq("organization_id", orgId),
      supabaseAdmin.from("staff_services").select("service_id, staff_profile_id"),
      supabaseAdmin.from("staff_resource_assignments").select("staff_profile_id, resource_id").eq("organization_id", orgId).eq("active", true),
      supabaseAdmin.from("resources").select("id, name").eq("organization_id", orgId),
    ]);
    const svcMap = new Map((svc ?? []).map((x: any) => [x.id, x.name]));
    const resMap = new Map((res ?? []).map((x: any) => [x.id, x.name]));
    const byStaffSvc = new Map<string, string[]>();
    for (const r of ss ?? []) {
      const n = svcMap.get(r.service_id); if (!n) continue;
      if (!byStaffSvc.has(r.staff_profile_id)) byStaffSvc.set(r.staff_profile_id, []);
      byStaffSvc.get(r.staff_profile_id)!.push(n);
    }
    const byStaffRes = new Map<string, string[]>();
    for (const r of sra ?? []) {
      const n = resMap.get(r.resource_id); if (!n) continue;
      if (!byStaffRes.has(r.staff_profile_id)) byStaffRes.set(r.staff_profile_id, []);
      byStaffRes.get(r.staff_profile_id)!.push(n);
    }
    const rows = (staff ?? []).map((s: any) => ({
      "Név": s.display_name,
      "Bemutatkozás": s.bio ?? "",
      "Aktív": s.active ? "Igen" : "Nem",
      "Heti munkaidő": JSON.stringify(s.working_hours_json ?? {}),
      "Létrehozva": s.created_at,
      "Szolgáltatások": (byStaffSvc.get(s.id) ?? []).join(", "),
      "Erőforrások": (byStaffRes.get(s.id) ?? []).join(", "),
    }));
    return { base64: sheetToBase64(rows, "Alkalmazottak"), filename: `alkalmazottak-${new Date().toISOString().slice(0,10)}.xlsx` };
  });

export const exportResourcesXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => OrgInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnerOrMember(context.userId, data.organizationId);
    const orgId = data.organizationId;
    const [{ data: res }, { data: svc }, { data: sr }, { data: staff }, { data: sra }] = await Promise.all([
      supabaseAdmin.from("resources").select("id, name, type, active, created_at").eq("organization_id", orgId).order("name"),
      supabaseAdmin.from("services").select("id, name").eq("organization_id", orgId),
      supabaseAdmin.from("service_resources").select("service_id, resource_id"),
      supabaseAdmin.from("staff_profiles").select("id, display_name").eq("organization_id", orgId),
      supabaseAdmin.from("staff_resource_assignments").select("staff_profile_id, resource_id").eq("organization_id", orgId).eq("active", true),
    ]);
    const svcMap = new Map((svc ?? []).map((x: any) => [x.id, x.name]));
    const staffMap = new Map((staff ?? []).map((x: any) => [x.id, x.display_name]));
    const byResSvc = new Map<string, string[]>();
    for (const r of sr ?? []) {
      const n = svcMap.get(r.service_id); if (!n) continue;
      if (!byResSvc.has(r.resource_id)) byResSvc.set(r.resource_id, []);
      byResSvc.get(r.resource_id)!.push(n);
    }
    const byResStaff = new Map<string, string[]>();
    for (const r of sra ?? []) {
      const n = staffMap.get(r.staff_profile_id); if (!n) continue;
      if (!byResStaff.has(r.resource_id)) byResStaff.set(r.resource_id, []);
      byResStaff.get(r.resource_id)!.push(n);
    }
    const rows = (res ?? []).map((r: any) => ({
      "Név": r.name,
      "Típus": r.type,
      "Aktív": r.active ? "Igen" : "Nem",
      "Létrehozva": r.created_at,
      "Szolgáltatások": (byResSvc.get(r.id) ?? []).join(", "),
      "Munkatársak": (byResStaff.get(r.id) ?? []).join(", "),
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

// ============ IMPORTS ============

const ImportInput = OrgInput.extend({ base64: z.string().min(1) });

function readRows(base64: string): any[] {
  const buf = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

export const importServicesXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ImportInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.userId, data.organizationId);
    const orgId = data.organizationId;
    const rows = readRows(data.base64);
    const [{ data: existingSvc }, { data: staff }, { data: res }] = await Promise.all([
      supabaseAdmin.from("services").select("id, name").eq("organization_id", orgId),
      supabaseAdmin.from("staff_profiles").select("id, display_name").eq("organization_id", orgId),
      supabaseAdmin.from("resources").select("id, name").eq("organization_id", orgId),
    ]);
    const svcByName = new Map((existingSvc ?? []).map((x: any) => [x.name.trim().toLowerCase(), x.id]));
    const staffByName = new Map((staff ?? []).map((x: any) => [x.display_name.trim().toLowerCase(), x.id]));
    const resByName = new Map((res ?? []).map((x: any) => [x.name.trim().toLowerCase(), x.id]));

    let created = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      const name = String(r["Név"] ?? "").trim();
      if (!name) { skipped++; continue; }
      const payload: any = {
        name,
        description: String(r["Leírás"] ?? "") || null,
        duration_minutes: Number(r["Időtartam (perc)"]) || 30,
        price: Number(r["Ár (Ft)"]) || 0,
        deposit_amount: Number(r["Foglaló (Ft)"]) || 0,
        deposit_required: parseBool(r["Foglaló kötelező"]),
        active: r["Aktív"] === "" ? true : parseBool(r["Aktív"]),
        tags: splitList(r["Címkék"]),
      };
      let id = svcByName.get(name.toLowerCase());
      if (id) {
        await supabaseAdmin.from("services").update(payload).eq("id", id);
        updated++;
      } else {
        const { data: ins } = await supabaseAdmin.from("services").insert({ ...payload, organization_id: orgId }).select("id").single();
        id = ins?.id;
        if (id) { svcByName.set(name.toLowerCase(), id); created++; }
      }
      if (!id) continue;
      // staff links
      const staffNames = splitList(r["Munkatársak"]);
      await supabaseAdmin.from("staff_services").delete().eq("service_id", id);
      const staffIds = staffNames.map((n) => staffByName.get(n.toLowerCase())).filter(Boolean) as string[];
      if (staffIds.length) {
        await supabaseAdmin.from("staff_services").insert(staffIds.map((sid) => ({ service_id: id, staff_profile_id: sid })));
      }
      // resource links
      const resNames = splitList(r["Erőforrások"]);
      await supabaseAdmin.from("service_resources").delete().eq("service_id", id);
      const resIds = resNames.map((n) => resByName.get(n.toLowerCase())).filter(Boolean) as string[];
      if (resIds.length) {
        await supabaseAdmin.from("service_resources").insert(resIds.map((rid) => ({ service_id: id, resource_id: rid, required: true, group_no: 1 })));
      }
    }
    return { created, updated, skipped, total: rows.length };
  });

export const importStaffXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ImportInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.userId, data.organizationId);
    const orgId = data.organizationId;
    const rows = readRows(data.base64);
    const [{ data: existing }, { data: svc }] = await Promise.all([
      supabaseAdmin.from("staff_profiles").select("id, display_name").eq("organization_id", orgId),
      supabaseAdmin.from("services").select("id, name").eq("organization_id", orgId),
    ]);
    const byName = new Map((existing ?? []).map((x: any) => [x.display_name.trim().toLowerCase(), x.id]));
    const svcByName = new Map((svc ?? []).map((x: any) => [x.name.trim().toLowerCase(), x.id]));

    let created = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      const name = String(r["Név"] ?? "").trim();
      if (!name) { skipped++; continue; }
      const payload: any = {
        display_name: name,
        bio: String(r["Bemutatkozás"] ?? "") || null,
        active: r["Aktív"] === "" ? true : parseBool(r["Aktív"]),
      };
      try {
        const wh = String(r["Heti munkaidő"] ?? "").trim();
        if (wh) payload.working_hours_json = JSON.parse(wh);
      } catch { /* ignore */ }
      let id = byName.get(name.toLowerCase());
      if (id) {
        await supabaseAdmin.from("staff_profiles").update(payload).eq("id", id);
        updated++;
      } else {
        const { data: ins } = await supabaseAdmin.from("staff_profiles").insert({ ...payload, organization_id: orgId }).select("id").single();
        id = ins?.id;
        if (id) { byName.set(name.toLowerCase(), id); created++; }
      }
      if (!id) continue;
      const svcNames = splitList(r["Szolgáltatások"]);
      if (svcNames.length || r["Szolgáltatások"] !== undefined) {
        // delete current staff_services for this staff
        const { data: own } = await supabaseAdmin.from("staff_services").select("id, service_id").eq("staff_profile_id", id);
        const ownSvcIds = new Set((svc ?? []).map((x: any) => x.id));
        const toDelete = (own ?? []).filter((x: any) => ownSvcIds.has(x.service_id)).map((x: any) => x.id);
        if (toDelete.length) await supabaseAdmin.from("staff_services").delete().in("id", toDelete);
        const ids = svcNames.map((n) => svcByName.get(n.toLowerCase())).filter(Boolean) as string[];
        if (ids.length) {
          await supabaseAdmin.from("staff_services").insert(ids.map((sid) => ({ service_id: sid, staff_profile_id: id })));
        }
      }
    }
    return { created, updated, skipped, total: rows.length };
  });

export const importResourcesXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ImportInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.userId, data.organizationId);
    const orgId = data.organizationId;
    const rows = readRows(data.base64);
    const [{ data: existing }, { data: svc }] = await Promise.all([
      supabaseAdmin.from("resources").select("id, name").eq("organization_id", orgId),
      supabaseAdmin.from("services").select("id, name").eq("organization_id", orgId),
    ]);
    const byName = new Map((existing ?? []).map((x: any) => [x.name.trim().toLowerCase(), x.id]));
    const svcByName = new Map((svc ?? []).map((x: any) => [x.name.trim().toLowerCase(), x.id]));

    let created = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      const name = String(r["Név"] ?? "").trim();
      if (!name) { skipped++; continue; }
      const payload: any = {
        name,
        type: String(r["Típus"] ?? "").trim() || "room",
        active: r["Aktív"] === "" ? true : parseBool(r["Aktív"]),
      };
      let id = byName.get(name.toLowerCase());
      if (id) {
        await supabaseAdmin.from("resources").update(payload).eq("id", id);
        updated++;
      } else {
        const { data: ins } = await supabaseAdmin.from("resources").insert({ ...payload, organization_id: orgId }).select("id").single();
        id = ins?.id;
        if (id) { byName.set(name.toLowerCase(), id); created++; }
      }
      if (!id) continue;
      // service_resources by resource
      if (r["Szolgáltatások"] !== undefined) {
        await supabaseAdmin.from("service_resources").delete().eq("resource_id", id);
        const svcNames = splitList(r["Szolgáltatások"]);
        const ids = svcNames.map((n) => svcByName.get(n.toLowerCase())).filter(Boolean) as string[];
        if (ids.length) {
          await supabaseAdmin.from("service_resources").insert(ids.map((sid) => ({ service_id: sid, resource_id: id, required: true, group_no: 1 })));
        }
      }
    }
    return { created, updated, skipped, total: rows.length };
  });
