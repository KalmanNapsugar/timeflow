import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "guest" | "staff" | "owner" | "platform_admin";

const IMPERSONATE_KEY = "ifx_impersonate_role";

const RANK: Record<AppRole, number> = { guest: 0, staff: 1, owner: 2, platform_admin: 3 };
function pickHighest(roles: AppRole[]): AppRole {
  if (roles.length === 0) return "guest";
  return [...roles].sort((a, b) => RANK[b] - RANK[a])[0];
}

interface AuthCtx {
  session: Session | null;
  user: User | null;
  /** Effektív szerepkörök (impersonálás figyelembevételével). */
  roles: AppRole[];
  /** Egyetlen, legmagasabb effektív szerepkör (UI gating-hez). */
  effectiveRole: AppRole;
  /** Valós szerepkörök az adatbázisból. */
  realRoles: AppRole[];
  /** Aktuálisan impersonált szerepkör (csak platform_admin). null = nincs impersonálás. */
  impersonatedRole: AppRole | null;
  setImpersonatedRole: (r: AppRole | null) => void;
  ownedOrgIds: string[];
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  roles: [],
  effectiveRole: "guest",
  realRoles: [],
  impersonatedRole: null,
  setImpersonatedRole: () => {},
  ownedOrgIds: [],
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [realRoles, setRealRoles] = useState<AppRole[]>([]);
  const [ownedOrgIds, setOwnedOrgIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [impersonatedRole, setImpersonatedRoleState] = useState<AppRole | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem(IMPERSONATE_KEY) as AppRole | null;
    if (stored) setImpersonatedRoleState(stored);
  }, []);

  function setImpersonatedRole(r: AppRole | null) {
    setImpersonatedRoleState(r);
    if (typeof window !== "undefined") {
      if (r) sessionStorage.setItem(IMPERSONATE_KEY, r);
      else sessionStorage.removeItem(IMPERSONATE_KEY);
    }
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => loadMeta(s.user.id), 0);
      } else {
        setRealRoles([]);
        setOwnedOrgIds([]);
        setImpersonatedRole(null);
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
    setRealRoles((rolesRes.data ?? []).map(r => r.role as AppRole));
    setOwnedOrgIds((orgsRes.data ?? []).map(o => o.id));
  }

  const isRealAdmin = realRoles.includes("platform_admin");
  const effectiveRoles: AppRole[] =
    isRealAdmin && impersonatedRole ? [impersonatedRole] : realRoles;

  return (
    <Ctx.Provider value={{
      session,
      user: session?.user ?? null,
      roles: effectiveRoles,
      realRoles,
      impersonatedRole: isRealAdmin ? impersonatedRole : null,
      setImpersonatedRole,
      ownedOrgIds,
      loading,
      signOut: async () => { setImpersonatedRole(null); await supabase.auth.signOut(); },
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
