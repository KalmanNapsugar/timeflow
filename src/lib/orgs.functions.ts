import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin } from "@/lib/supabase-admin-loader";

const ClaimInput = z.object({ slug: z.string().min(1).max(120) });

export const claimDemoOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ClaimInput.parse(d))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    const { userId } = context;
    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .select("id, owner_id, slug")
      .eq("slug", data.slug)
      .single();
    if (error || !org) throw new Error("Szervezet nem található");
    if (org.owner_id && org.owner_id !== userId) {
      throw new Error("Ennek a szervezetnek már van tulajdonosa");
    }
    if (!org.owner_id) {
      const { error: uErr } = await supabaseAdmin
        .from("organizations")
        .update({ owner_id: userId })
        .eq("id", org.id);
      if (uErr) throw new Error(uErr.message);
    }
    return { organizationId: org.id };
  });

const CreateInput = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, "Csak kisbetű, szám és kötőjel"),
  description: z.string().max(500).optional().nullable(),
});

export const createOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    const { userId } = context;

    // Egyediség ellenőrzés
    const { data: existing } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("slug", data.slug)
      .maybeSingle();
    if (existing) throw new Error("Ez a slug már foglalt");

    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .insert({
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        owner_id: userId,
        public_profile_enabled: true,
      })
      .select("id, slug")
      .single();
    if (error || !org) throw new Error(error?.message ?? "Nem sikerült létrehozni");

    // 'owner' szerepkör hozzáadása ha még nincs
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "owner" }, { onConflict: "user_id,role" });

    return { organizationId: org.id, slug: org.slug };
  });
