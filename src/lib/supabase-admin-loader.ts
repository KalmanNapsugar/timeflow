type SupabaseAdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

let adminClientPromise: Promise<SupabaseAdminClient> | null = null;

export function getSupabaseAdmin(): Promise<SupabaseAdminClient> {
  adminClientPromise ??= import("@/integrations/supabase/client.server").then(
    (module) => module.supabaseAdmin,
  );
  return adminClientPromise;
}