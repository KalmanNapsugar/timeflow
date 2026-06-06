import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/lib/supabase-admin-loader";

const ROLES = ["guest", "customer", "staff", "owner", "platform_admin"] as const;
type Role = (typeof ROLES)[number];

async function assertAdmin(userId: string) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "platform_admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    // Bootstrap: ha még senki sem admin, az első hívó kapja meg.
    const { count, error: cErr } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "platform_admin");
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) === 0) {
      await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "platform_admin" });
      return;
    }
    throw new Error("Nincs jogosultságod (platform_admin szükséges)");
  }
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const supabaseAdmin = await getSupabaseAdmin();
    const { data: usersData, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    const ids = usersData.users.map(u => u.id);
    const [{ data: roles }, { data: profiles }, { data: orgs }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
      supabaseAdmin.from("profiles").select("auth_user_id, full_name, phone").in("auth_user_id", ids),
      supabaseAdmin.from("organizations").select("id, name, owner_id").in("owner_id", ids),
    ]);
    return usersData.users.map(u => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      confirmed: !!u.email_confirmed_at,
      full_name: profiles?.find(p => p.auth_user_id === u.id)?.full_name ?? null,
      phone: profiles?.find(p => p.auth_user_id === u.id)?.phone ?? null,
      roles: (roles ?? []).filter(r => r.user_id === u.id).map(r => r.role as Role),
      orgs: (orgs ?? []).filter(o => o.owner_id === u.id).map(o => ({ id: o.id, name: o.name })),
    }));
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    userId: z.string().uuid(),
    role: z.enum(ROLES),
    enabled: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.enabled) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      if (data.userId === context.userId && data.role === "platform_admin") {
        throw new Error("Saját admin jogod nem veheted el");
      }
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) throw new Error("Saját fiókot nem törölhetsz");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertRolePermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    route_path: z.string().min(1).max(200),
    label: z.string().min(1).max(200).optional(),
    roles: z.array(z.enum(ROLES)),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    // Védelem: /admin-ról ne lehessen kivenni a platform_admin-t.
    if (data.route_path === "/admin" && !data.roles.includes("platform_admin")) {
      throw new Error("Az /admin oldalról nem távolítható el a platform_admin szerepkör");
    }
    const payload: any = { route_path: data.route_path, roles: data.roles, updated_at: new Date().toISOString() };
    if (data.label) payload.label = data.label;
    const { error } = await supabaseAdmin
      .from("role_permissions")
      .upsert(payload, { onConflict: "route_path" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteRolePermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ route_path: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.route_path === "/admin") throw new Error("Az /admin engedélysor nem törölhető");
    const { error } = await supabaseAdmin.from("role_permissions").delete().eq("route_path", data.route_path);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

