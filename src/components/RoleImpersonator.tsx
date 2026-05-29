import { useAuth, type AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Eye, X, Store } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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
  const { realRoles, impersonatedRole, setImpersonatedRole, viewingOrgId, setViewingOrgId } = useAuth();
  const isAdmin = realRoles.includes("platform_admin");

  const { data: orgs } = useQuery({
    queryKey: ["admin-all-orgs"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("id, name, slug").order("name");
      return data ?? [];
    },
  });

  if (!isAdmin) return null;

  const active = impersonatedRole;

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
              {orgs?.map(o => (
                <SelectItem key={o.id} value={o.id} className="text-xs">{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(active || viewingOrgId) && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-full"
            onClick={() => { setImpersonatedRole(null); setViewingOrgId(null); }}
            title="Visszaállítás"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
