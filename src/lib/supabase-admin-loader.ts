import { createServerOnlyFn } from "@tanstack/react-start";

type SupabaseAdminClient = any;

let adminClientPromise: Promise<SupabaseAdminClient> | null = null;

export const getSupabaseAdmin = createServerOnlyFn(async (): Promise<SupabaseAdminClient> => {
  adminClientPromise ??= import("@/integrations/supabase/client.server").then(
    (module) => module.supabaseAdmin,
  );
  return adminClientPromise;
});