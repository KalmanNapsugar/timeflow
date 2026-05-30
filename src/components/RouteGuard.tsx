import { useEffect } from "react";
import { useLocation, useNavigate, useMatches } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useCanAccess, usePermissions } from "@/lib/permissions";

/**
 * Globális útvonal-őr. Minden navigációnál ellenőrzi, hogy a felhasználó
 * effektív szerepköre hozzáférhet-e az adott útvonalhoz. Ha nem, visszadob
 * a főoldalra. Dinamikus útvonalakat (pl. /book/$slug) a router routeId-je
 * alapján azonosítja, így a jogosultság-mátrixban a $paramos kulcsok is
 * érvényesülnek.
 */
export function RouteGuard() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const matches = useMatches();
  const { effectiveRole, loading } = useAuth();
  const canAccess = useCanAccess();
  const { isLoading: permsLoading } = usePermissions();

  // Mindig publikus útvonalak — szerepkörtől függetlenül elérhetők.
  // Különösen a /login: kijelentkezés után a felhasználónak vissza kell tudnia jutni ide.
  const ALWAYS_PUBLIC = new Set<string>([
    "/", "/login", "/search",
    "/provider/$slug", "/book/$slug", "/book/confirmed/$bookingId",
  ]);

  useEffect(() => {
    if (loading || permsLoading) return;
    if (pathname === "/") return;

    // A legmélyebb (leaf) match routeId-je a leginkább specifikus – pl. "/book/$slug"
    const leaf = matches[matches.length - 1];
    const routeId = leaf?.routeId ?? pathname;

    if (ALWAYS_PUBLIC.has(routeId) || ALWAYS_PUBLIC.has(pathname)) return;

    // Próbáljuk először a routeId-t (dinamikus minta), majd a sima pathname-t.
    const allowedByRoute = canAccess(routeId, effectiveRole);
    const allowedByPath = canAccess(pathname, effectiveRole);

    if (!allowedByRoute || !allowedByPath) {
      toast.error("Nincs jogosultságod ehhez az oldalhoz");
      navigate({ to: "/", replace: true });
    }
  }, [pathname, effectiveRole, loading, permsLoading, canAccess, navigate, matches]);

  return null;
}
