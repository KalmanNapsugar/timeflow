import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function getUserEmail(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw new Error("Felhasználó nem található");
  return data.user.email.toLowerCase();
}

async function assertOwner(userId: string, orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("organizations").select("owner_id").eq("id", orgId).single();
  if (error || !data) throw new Error("Üzlet nem található");
  if (data.owner_id !== userId) throw new Error("Csak a tulajdonos végezheti el ezt a műveletet");
}

export const inviteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    organizationId: z.string().uuid(),
    email: z.string().email().max(255),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.userId, data.organizationId);
    const email = data.email.toLowerCase().trim();

    // Find user by email
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const target = users.users.find(u => (u.email ?? "").toLowerCase() === email);
    if (!target) throw new Error("Nincs regisztrált felhasználó ezzel az e-mail címmel");
    if (target.id === context.userId) throw new Error("Magadat nem hívhatod meg");

    // Already a member?
    const { data: existing } = await supabaseAdmin
      .from("organization_members").select("id, active")
      .eq("organization_id", data.organizationId).eq("user_id", target.id).maybeSingle();
    if (existing?.active) throw new Error("Ez a felhasználó már alkalmazott");

    // Upsert pending invitation (replace any old pending)
    const { error: delErr } = await supabaseAdmin
      .from("staff_invitations").delete()
      .eq("organization_id", data.organizationId)
      .ilike("invited_email", email)
      .eq("status", "pending");
    if (delErr) throw new Error(delErr.message);

    const { error } = await supabaseAdmin.from("staff_invitations").insert({
      organization_id: data.organizationId,
      invited_email: email,
      invited_by: context.userId,
      status: "pending",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listOrgInvitations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ organizationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.userId, data.organizationId);
    const { data: rows, error } = await supabaseAdmin
      .from("staff_invitations").select("*")
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listOrgMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ organizationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.userId, data.organizationId);
    const { data: members, error } = await supabaseAdmin
      .from("organization_members").select("id, user_id, role, active, created_at")
      .eq("organization_id", data.organizationId);
    if (error) throw new Error(error.message);
    const ids = (members ?? []).map(m => m.user_id);
    if (ids.length === 0) return [];
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    return (members ?? []).map(m => {
      const u = users.users.find(uu => uu.id === m.user_id);
      return { ...m, email: u?.email ?? "(ismeretlen)" };
    });
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invitationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: inv } = await supabaseAdmin
      .from("staff_invitations").select("organization_id").eq("id", data.invitationId).single();
    if (!inv) throw new Error("Meghívás nem található");
    await assertOwner(context.userId, inv.organization_id);
    const { error } = await supabaseAdmin.from("staff_invitations")
      .update({ status: "revoked", responded_at: new Date().toISOString() })
      .eq("id", data.invitationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeStaffMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ memberId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: m } = await supabaseAdmin
      .from("organization_members").select("organization_id, user_id").eq("id", data.memberId).single();
    if (!m) throw new Error("Tag nem található");
    await assertOwner(context.userId, m.organization_id);
    const { error } = await supabaseAdmin.from("organization_members").delete().eq("id", data.memberId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = await getUserEmail(context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("staff_invitations").select("id, organization_id, status, created_at")
      .ilike("invited_email", email)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const orgIds = (rows ?? []).map(r => r.organization_id);
    if (orgIds.length === 0) return [];
    const { data: orgs } = await supabaseAdmin
      .from("organizations").select("id, name, slug").in("id", orgIds);
    return (rows ?? []).map(r => ({
      ...r,
      organization: orgs?.find(o => o.id === r.organization_id) ?? null,
    }));
  });

export const respondInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    invitationId: z.string().uuid(),
    accept: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const email = await getUserEmail(context.userId);
    const { data: inv, error: iErr } = await supabaseAdmin
      .from("staff_invitations").select("*").eq("id", data.invitationId).single();
    if (iErr || !inv) throw new Error("Meghívás nem található");
    if (inv.invited_email.toLowerCase() !== email) throw new Error("Ez a meghívás nem hozzád tartozik");
    if (inv.status !== "pending") throw new Error("Ez a meghívás már nem aktív");

    if (data.accept) {
      // Add as active staff member (upsert)
      const { data: existing } = await supabaseAdmin
        .from("organization_members").select("id")
        .eq("organization_id", inv.organization_id).eq("user_id", context.userId).maybeSingle();
      if (existing) {
        await supabaseAdmin.from("organization_members")
          .update({ active: true, role: "staff" }).eq("id", existing.id);
      } else {
        const { error: mErr } = await supabaseAdmin.from("organization_members").insert({
          organization_id: inv.organization_id,
          user_id: context.userId,
          role: "staff",
          active: true,
        });
        if (mErr) throw new Error(mErr.message);
      }
      await supabaseAdmin.from("user_roles")
        .upsert({ user_id: context.userId, role: "staff" }, { onConflict: "user_id,role" });
    }

    const { error: uErr } = await supabaseAdmin.from("staff_invitations")
      .update({
        status: data.accept ? "accepted" : "declined",
        responded_at: new Date().toISOString(),
      }).eq("id", inv.id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });

// --- Admin: list all organizations with their members ---
export const listOrganizationsWithMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "platform_admin").maybeSingle();
    if (!isAdmin) throw new Error("Csak platform admin");

    const [{ data: orgs }, { data: members }, { data: users }] = await Promise.all([
      supabaseAdmin.from("organizations").select("id, name, slug, owner_id, archived_at").order("name"),
      supabaseAdmin.from("organization_members").select("organization_id, user_id, role, active"),
      supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
    ]);

    const emailOf = (id: string | null) => id ? (users?.users.find(u => u.id === id)?.email ?? id.slice(0, 8)) : null;

    return (orgs ?? []).map(o => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      owner_id: o.owner_id,
      owner_email: emailOf(o.owner_id),
      archived_at: o.archived_at as string | null,
      members: (members ?? [])
        .filter(m => m.organization_id === o.id)
        .map(m => ({ user_id: m.user_id, email: emailOf(m.user_id), role: m.role, active: m.active })),
  }));
  });

export const listStaffProfiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ organizationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.userId, data.organizationId);
    const { data: profiles, error } = await supabaseAdmin
      .from("staff_profiles").select("*")
      .eq("organization_id", data.organizationId)
      .order("created_at");
    if (error) throw new Error(error.message);
    const ids = (profiles ?? []).map(p => p.user_id).filter(Boolean) as string[];
    if (ids.length === 0) return (profiles ?? []).map(p => ({ ...p, email: null }));
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    return (profiles ?? []).map(p => ({
      ...p,
      email: p.user_id ? (users?.users.find(u => u.id === p.user_id)?.email ?? null) : null,
    }));
  });
