import { createServerOnlyFn } from "@tanstack/react-start";

type SupabaseAdminClient = Awaited<ReturnType<typeof loadSupabaseAdmin>>;

let adminClientPromise: Promise<SupabaseAdminClient> | null = null;

async function loadSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const getSupabaseAdmin = createServerOnlyFn(async (): Promise<SupabaseAdminClient> => {
  adminClientPromise ??= loadSupabaseAdmin();
  return adminClientPromise;
});