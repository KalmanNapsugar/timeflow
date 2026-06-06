import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/lib/supabase-admin-loader";

async function assertAdmin(userId: string) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "platform_admin").maybeSingle();
  if (!data) throw new Error("Csak platform admin használhatja ezt a funkciót");
}

export const startImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    targetUserId: z.string().uuid(),
    reason: z.string().min(5, "Adj meg indokot (min. 5 karakter)").max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("impersonation_log")
      .insert({ admin_user_id: context.userId, target_user_id: data.targetUserId, reason: data.reason })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { sessionId: row.id };
  });

export const endImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    await supabaseAdmin.from("impersonation_log").update({ ended_at: new Date().toISOString() })
      .eq("id", data.sessionId).eq("admin_user_id", context.userId);
    return { ok: true };
  });

export const logImpersonationView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ sessionId: z.string().uuid(), route: z.string().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: row } = await supabaseAdmin.from("impersonation_log").select("viewed_routes").eq("id", data.sessionId).maybeSingle();
    const arr = Array.isArray(row?.viewed_routes) ? row!.viewed_routes : [];
    arr.push({ route: data.route, at: new Date().toISOString() });
    await supabaseAdmin.from("impersonation_log").update({ viewed_routes: arr }).eq("id", data.sessionId);
    return { ok: true };
  });

/** Lekérdezi egy adott felhasználó READ-ONLY képét: profil, foglalások, üzletek. */
export const viewUserSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ targetUserId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const [{ data: profile }, { data: bookings }, { data: orgs }, { data: u }] = await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("auth_user_id", data.targetUserId).maybeSingle(),
      supabaseAdmin.from("bookings").select("id, start_at, end_at, status, service_id, organization_id, price_total")
        .eq("customer_auth_user_id", data.targetUserId).order("start_at", { ascending: false }).limit(50),
      supabaseAdmin.from("organizations").select("id, name, slug").eq("owner_id", data.targetUserId),
      supabaseAdmin.auth.admin.getUserById(data.targetUserId),
    ]);
    return {
      email: u.user?.email ?? null,
      created_at: u.user?.created_at ?? null,
      profile,
      bookings: bookings ?? [],
      organizations: orgs ?? [],
    };
  });

export const listImpersonationLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data } = await supabaseAdmin
      .from("impersonation_log")
      .select("id, admin_user_id, target_user_id, reason, started_at, ended_at")
      .order("started_at", { ascending: false })
      .limit(100);
    return data ?? [];
  });
