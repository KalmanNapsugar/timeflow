import { useAuth, type AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Eye, X } from "lucide-react";

const ROLES: { value: AppRole; label: string }[] = [
  { value: "platform_admin", label: "Platform admin" },
  { value: "owner", label: "Üzlet tulajdonos" },
  { value: "staff", label: "Alkalmazott" },
  { value: "customer", label: "Ügyfél" },
  { value: "guest", label: "Vendég" },
];

export function RoleImpersonator() {
  const { realRoles, impersonatedRole, setImpersonatedRole } = useAuth();
  if (!realRoles.includes("platform_admin")) return null;

  const active = impersonatedRole;

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 max-w-[95vw]">
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-full border bg-background/95 backdrop-blur shadow-lg text-xs">
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
              onClick={() => setImpersonatedRole(r.value === "platform_admin" ? null : r.value)}
            >
              {r.label}
            </Button>
          );
        })}
        {active && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-full"
            onClick={() => setImpersonatedRole(null)}
            title="Impersonálás kikapcsolása"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
