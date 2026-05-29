import { useEffect } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useCanAccess, usePermissions } from "@/lib/permissions";

/**
 * Globális útvonal-őr. Minden navigációnál ellenőrzi, hogy a felhasználó
 * effektív szerepköre hozzáférhet-e az adott útvonalhoz. Ha nem, visszadob
 * a főoldalra. Új útvonalakat a role_permissions tábla / DEFAULT_ROUTE_ACCESS
 * automatikusan szabályoz – ha egy útvonalhoz nincs bejegyzés, mindenki látja.
 */
export function RouteGuard() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { effectiveRole, loading } = useAuth();
  const canAccess = useCanAccess();
  const { isLoading: permsLoading } = usePermissions();

  useEffect(() => {
    if (loading || permsLoading) return;
    if (pathname === "/") return;
    if (!canAccess(pathname, effectiveRole)) {
      toast.error("Nincs jogosultságod ehhez az oldalhoz");
      navigate({ to: "/", replace: true });
    }
  }, [pathname, effectiveRole, loading, permsLoading, canAccess, navigate]);

  return null;
}
