import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "guest" | "staff" | "owner" | "platform_admin";

interface AuthCtx {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  ownedOrgIds: string[];
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  roles: [],
  ownedOrgIds: [],
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [ownedOrgIds, setOwnedOrgIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => loadMeta(s.user.id), 0);
      } else {
        setRoles([]);
        setOwnedOrgIds([]);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadMeta(data.session.user.id);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadMeta(userId: string) {
    const [rolesRes, orgsRes] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("organizations").select("id").eq("owner_id", userId),
    ]);
    setRoles((rolesRes.data ?? []).map(r => r.role as AppRole));
    setOwnedOrgIds((orgsRes.data ?? []).map(o => o.id));
  }

  return (
    <Ctx.Provider value={{
      session,
      user: session?.user ?? null,
      roles,
      ownedOrgIds,
      loading,
      signOut: async () => { await supabase.auth.signOut(); },
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
