import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "guest" | "customer" | "staff" | "owner" | "platform_admin";

const IMPERSONATE_KEY = "ifx_impersonate_role";
const VIEWING_ORG_KEY = "ifx_viewing_org_id";
const VIEWING_STAFF_KEY = "ifx_viewing_staff_id";

const RANK: Record<AppRole, number> = { guest: 0, customer: 1, staff: 2, owner: 3, platform_admin: 4 };
function pickHighest(roles: AppRole[]): AppRole {
  if (roles.length === 0) return "guest";
  return [...roles].sort((a, b) => RANK[b] - RANK[a])[0];
}

export type MyOrg = { id: string; name: string; role: "owner" | "staff" };

interface AuthCtx {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  effectiveRole: AppRole;
  realRoles: AppRole[];
  impersonatedRole: AppRole | null;
  setImpersonatedRole: (r: AppRole | null) => void;
  /** Az aktuálisan kiválasztott üzlet id-ja (admin: bármelyik; egyébként saját üzletek közül). */
  viewingOrgId: string | null;
  setViewingOrgId: (id: string | null) => void;
  /** Csak nézet: melyik staff_profile szemszögéből nézzük az alkalmazott felületet. */
  viewingStaffProfileId: string | null;
  setViewingStaffProfileId: (id: string | null) => void;
  ownedOrgIds: string[];
  /** A felhasználó saját üzletei (mint tulajdonos vagy alkalmazott). */
  myOrgs: MyOrg[];
  /** Csak betekintés mód: a platform admin egy idegen üzletet néz, nem szerkeszthet. */
  readOnly: boolean;
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
  viewingOrgId: null,
  setViewingOrgId: () => {},
  viewingStaffProfileId: null,
  setViewingStaffProfileId: () => {},
  ownedOrgIds: [],
  myOrgs: [],
  readOnly: false,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [realRoles, setRealRoles] = useState<AppRole[]>([]);
  const [ownedOrgIds, setOwnedOrgIds] = useState<string[]>([]);
  const [myOrgs, setMyOrgs] = useState<MyOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [impersonatedRole, setImpersonatedRoleState] = useState<AppRole | null>(null);
  const [viewingOrgId, setViewingOrgIdState] = useState<string | null>(null);
  const [viewingStaffProfileId, setViewingStaffProfileIdState] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem(IMPERSONATE_KEY) as AppRole | null;
    if (stored) setImpersonatedRoleState(stored);
    const v = sessionStorage.getItem(VIEWING_ORG_KEY);
    if (v) setViewingOrgIdState(v);
    const s = sessionStorage.getItem(VIEWING_STAFF_KEY);
    if (s) setViewingStaffProfileIdState(s);
  }, []);

  function setImpersonatedRole(r: AppRole | null) {
    setImpersonatedRoleState(r);
    if (typeof window !== "undefined") {
      if (r) sessionStorage.setItem(IMPERSONATE_KEY, r);
      else sessionStorage.removeItem(IMPERSONATE_KEY);
    }
  }

  function setViewingOrgId(id: string | null) {
    setViewingOrgIdState(id);
    if (typeof window !== "undefined") {
      if (id) sessionStorage.setItem(VIEWING_ORG_KEY, id);
      else sessionStorage.removeItem(VIEWING_ORG_KEY);
    }
    // Üzletváltáskor a kiválasztott staff nézet ne maradjon ragadva.
    setViewingStaffProfileId(null);
  }

  function setViewingStaffProfileId(id: string | null) {
    setViewingStaffProfileIdState(id);
    if (typeof window !== "undefined") {
      if (id) sessionStorage.setItem(VIEWING_STAFF_KEY, id);
      else sessionStorage.removeItem(VIEWING_STAFF_KEY);
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
        setMyOrgs([]);
        setImpersonatedRole(null);
      }
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        await loadMeta(data.session.user.id);
      }
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadMeta(userId: string) {
    const [rolesRes, ownedRes, memRes] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("organizations").select("id, name").eq("owner_id", userId),
      supabase.from("organization_members").select("organization_id").eq("user_id", userId).eq("active", true),
    ]);
    setRealRoles((rolesRes.data ?? []).map(r => r.role as AppRole));
    const owned: MyOrg[] = (ownedRes.data ?? []).map(o => ({ id: o.id, name: o.name, role: "owner" as const }));
    setOwnedOrgIds(owned.map(o => o.id));
    const ownedSet = new Set(owned.map(o => o.id));
    const memberIds = (memRes.data ?? []).map(m => m.organization_id).filter(id => !ownedSet.has(id));
    let memberOrgs: MyOrg[] = [];
    if (memberIds.length) {
      const { data } = await supabase.from("organizations").select("id, name").in("id", memberIds);
      memberOrgs = (data ?? []).map(o => ({ id: o.id, name: o.name, role: "staff" as const }));
    }
    setMyOrgs([...owned, ...memberOrgs]);
  }

  const isRealAdmin = realRoles.includes("platform_admin");

  // Non-admin "aktív üzlet": választott üzlet, vagy alapértelmezett (első saját).
  const nonAdminCurrentOrg: MyOrg | null = !isRealAdmin
    ? (myOrgs.find(o => o.id === viewingOrgId) ?? myOrgs[0] ?? null)
    : null;

  const effectiveRoles: AppRole[] =
    isRealAdmin && impersonatedRole ? [impersonatedRole] : realRoles;

  // Effektív szerepkör: admin impersonáláskor pontos; egyébként legmagasabb saját szerep + aktív üzlet szerepe.
  const effectiveRole: AppRole = (isRealAdmin && impersonatedRole)
    ? impersonatedRole
    : pickHighest([
        ...realRoles,
        ...(nonAdminCurrentOrg?.role === "owner" ? (["owner"] as AppRole[]) : []),
        ...(nonAdminCurrentOrg?.role === "staff" ? (["staff"] as AppRole[]) : []),
        ...(session ? (["customer"] as AppRole[]) : []),
      ]);

  // Effektív ownedOrgIds: admin betekintés → a választott; egyébként az aktuálisan kiválasztott saját üzlet.
  const effectiveOwnedOrgIds = isRealAdmin
    ? (viewingOrgId ? [viewingOrgId] : ownedOrgIds)
    : (nonAdminCurrentOrg ? [nonAdminCurrentOrg.id] : []);

  // Csak betekintés: platform admin idegen üzletet néz, ÉS nem owner/staff szerepben van a saját üzletei között.
  const adminInOwnOrgAsRole =
    isRealAdmin && !!viewingOrgId && (impersonatedRole === "owner" || impersonatedRole === "staff")
    && myOrgs.some(o => o.id === viewingOrgId);
  const readOnly = isRealAdmin && !!viewingOrgId && !ownedOrgIds.includes(viewingOrgId) && !adminInOwnOrgAsRole;

  return (
    <Ctx.Provider value={{
      session,
      user: session?.user ?? null,
      roles: effectiveRoles,
      effectiveRole,
      realRoles,
      impersonatedRole: isRealAdmin ? impersonatedRole : null,
      setImpersonatedRole,
      viewingOrgId: isRealAdmin ? viewingOrgId : (nonAdminCurrentOrg?.id ?? null),
      setViewingOrgId,
      viewingStaffProfileId,
      setViewingStaffProfileId,
      ownedOrgIds: effectiveOwnedOrgIds,
      myOrgs,
      readOnly,
      loading,
      signOut: async () => { setImpersonatedRole(null); setViewingOrgId(null); setViewingStaffProfileId(null); await supabase.auth.signOut(); },
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
