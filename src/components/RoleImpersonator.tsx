import { useAuth, type AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Eye, X, Store, UserCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROLES: { value: AppRole; label: string }[] = [
  { value: "platform_admin", label: "Platform admin" },
  { value: "owner", label: "Üzlet tulajdonos" },
  { value: "staff", label: "Alkalmazott" },
  { value: "customer", label: "Ügyfél" },
  { value: "guest", label: "Vendég" },
];

export function RoleImpersonator() {
  const {
    realRoles, impersonatedRole, setImpersonatedRole,
    viewingOrgId, setViewingOrgId, myOrgs,
    viewingStaffProfileId, setViewingStaffProfileId,
  } = useAuth();
  const isAdmin = realRoles.includes("platform_admin");
  const active = impersonatedRole;

  const { data: allOrgs } = useQuery({
    queryKey: ["admin-all-orgs"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("id, name, slug").order("name");
      return data ?? [];
    },
  });

  // Ha admin "owner"/"staff" szerepben van, csak a saját üzletei közül választhat.
  const pickerOrgs = useMemo(() => {
    if (active === "owner") {
      return myOrgs.filter(o => o.role === "owner").map(o => ({ id: o.id, name: o.name }));
    }
    if (active === "staff") {
      return myOrgs.map(o => ({ id: o.id, name: o.name }));
    }
    return (allOrgs ?? []).map(o => ({ id: o.id, name: o.name }));
  }, [active, myOrgs, allOrgs]);

  // Ha vált, és az aktuális üzlet nincs a választhatók közt, alapértelmezzük az elsőre (vagy nullára).
  useEffect(() => {
    if (active === "owner" || active === "staff") {
      if (!viewingOrgId || !pickerOrgs.some(o => o.id === viewingOrgId)) {
        setViewingOrgId(pickerOrgs[0]?.id ?? null);
      }
    }
  }, [active, pickerOrgs, viewingOrgId, setViewingOrgId]);

  // Az aktuálisan választott üzlet alkalmazottai — staff-szemszögű előnézethez.
  // Akkor érhető el, ha a felhasználó az adott üzlet tulajdonosa, vagy platform admin.
  const canPickStaffOf = isAdmin
    ? viewingOrgId
    : (myOrgs.find(o => o.id === (viewingOrgId ?? myOrgs[0]?.id))?.role === "owner"
        ? (viewingOrgId ?? myOrgs[0]?.id ?? null)
        : null);

  const { data: staffOfOrg } = useQuery({
    queryKey: ["impersonator-staff", canPickStaffOf],
    enabled: !!canPickStaffOf,
    queryFn: async () => {
      const { data } = await supabase.from("staff_profiles")
        .select("id, display_name")
        .eq("organization_id", canPickStaffOf!)
        .eq("active", true)
        .order("display_name");
      return data ?? [];
    },
  });

  // Ha a kiválasztott staff már nem tartozik az aktuális üzlethez, töröljük.
  useEffect(() => {
    if (viewingStaffProfileId && staffOfOrg && !staffOfOrg.some((s: any) => s.id === viewingStaffProfileId)) {
      setViewingStaffProfileId(null);
    }
  }, [viewingStaffProfileId, staffOfOrg, setViewingStaffProfileId]);

  const StaffPicker = canPickStaffOf ? (
    <div className="flex items-center gap-1 ml-1 pl-2 border-l">
      <UserCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
      <Select
        value={viewingStaffProfileId ?? "__none__"}
        onValueChange={(v) => {
          if (v === "__none__") { setViewingStaffProfileId(null); return; }
          setViewingStaffProfileId(v);
          if (isAdmin && active !== "staff") setImpersonatedRole("staff");
        }}
      >
        <SelectTrigger className="h-7 text-xs w-[170px] rounded-full">
          <SelectValue placeholder="Alkalmazott nézete…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__" className="text-xs">— Saját nézet —</SelectItem>
          {(staffOfOrg ?? []).map((s: any) => (
            <SelectItem key={s.id} value={s.id} className="text-xs">{s.display_name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ) : null;

  // Nem admin felhasználó: csak akkor mutassuk a sávot, ha legalább 2 üzlethez van köze.
  if (!isAdmin) {
    if (myOrgs.length < 2) return null;
    const current = myOrgs.find(o => o.id === viewingOrgId) ?? myOrgs[0];
    return (
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 max-w-[95vw]">
        <div className="flex items-center gap-1 px-2 py-1.5 rounded-full border bg-background/95 backdrop-blur shadow-lg text-xs">
          <div className="flex items-center gap-1 px-2 text-muted-foreground shrink-0">
            <Store className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Üzlet:</span>
          </div>
          <Select value={current?.id ?? ""} onValueChange={(v) => setViewingOrgId(v || null)}>
            <SelectTrigger className="h-7 text-xs w-[200px] rounded-full">
              <SelectValue placeholder="Üzlet…" />
            </SelectTrigger>
            <SelectContent>
              {myOrgs.map(o => (
                <SelectItem key={o.id} value={o.id} className="text-xs">
                  {o.name} <span className="text-muted-foreground ml-1">· {o.role === "owner" ? "tulaj" : "alkalmazott"}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {StaffPicker}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 max-w-[95vw]">
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-full border bg-background/95 backdrop-blur shadow-lg text-xs flex-wrap">
        <div className="flex items-center gap-1 px-2 text-muted-foreground shrink-0">
          <Eye className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Nézet:</span>
        </div>
        {ROLES.map(r => {
          const isActive = active === r.value || (!active && r.value === "platform_admin");
          return (
            <Button
              key={r.value}
              size="sm"
              variant={isActive ? "default" : "ghost"}
              className="h-7 px-2 text-xs rounded-full"
              onClick={() => {
                const next = r.value === "platform_admin" ? null : r.value;
                setImpersonatedRole(next);
                if (r.value === "platform_admin") setViewingOrgId(null);
              }}
            >
              {r.label}
            </Button>
          );
        })}
        <div className="flex items-center gap-1 ml-1 pl-2 border-l">
          <Store className="w-3.5 h-3.5 text-muted-foreground" />
          <Select value={viewingOrgId ?? ""} onValueChange={(v) => setViewingOrgId(v || null)}>
            <SelectTrigger className="h-7 text-xs w-[160px] rounded-full">
              <SelectValue placeholder="Üzlet…" />
            </SelectTrigger>
            <SelectContent>
              {pickerOrgs.map(o => (
                <SelectItem key={o.id} value={o.id} className="text-xs">{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {StaffPicker}
        {(active || viewingOrgId || viewingStaffProfileId) && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-full"
            onClick={() => { setImpersonatedRole(null); setViewingOrgId(null); setViewingStaffProfileId(null); }}
            title="Visszaállítás"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
