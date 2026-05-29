import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ClaimInput = z.object({ slug: z.string().min(1).max(120) });

export const claimDemoOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ClaimInput.parse(d))
  .handler(async ({ data, context }) => {
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
