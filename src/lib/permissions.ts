import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth";

export type EffectiveRole = AppRole;

/** Beépített alapértelmezett mátrix – fallback ha a DB nem érhető el. */
export const DEFAULT_ROUTE_ACCESS: Record<string, AppRole[]> = {
  "/": ["guest", "customer", "staff", "owner", "platform_admin"],
  "/search": ["guest", "customer", "staff", "owner", "platform_admin"],
  "/login": ["guest", "customer", "staff", "owner", "platform_admin"],
  "/my-bookings": ["customer", "staff", "owner", "platform_admin"],
  "/organizations/new": ["customer", "staff", "owner", "platform_admin"],
  "/dashboard": ["staff", "owner", "platform_admin"],
  "/dashboard/calendar": ["staff", "owner", "platform_admin"],
  "/dashboard/customers": ["staff", "owner", "platform_admin"],
  "/dashboard/services": ["owner", "platform_admin"],
  "/dashboard/staff": ["owner", "platform_admin"],
  "/dashboard/resources": ["owner", "platform_admin"],
  "/dashboard/marketing": ["owner", "platform_admin"],
  "/dashboard/reviews": ["owner", "platform_admin"],
  "/dashboard/reports": ["owner", "platform_admin"],
  "/dashboard/inventory": ["staff", "owner", "platform_admin"],
  "/dashboard/settings": ["owner", "platform_admin"],
  "/dashboard/audit-log": ["owner", "platform_admin"],
  "/dashboard/ai-assistant": ["owner", "platform_admin"],
  "/admin": ["platform_admin"],
};

export const ROLE_LABEL: Record<AppRole, string> = {
  guest: "Vendég (nem regisztrált)",
  customer: "Ügyfél (regisztrált)",
  staff: "Alkalmazott",
  owner: "Üzlet tulajdonos",
  platform_admin: "Platform admin",
};

export type RoutePermission = { route_path: string; label: string; roles: AppRole[] };

export function usePermissions() {
  return useQuery<Record<string, AppRole[]>>({
    queryKey: ["role_permissions"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("route_path, roles");
      if (error || !data) return DEFAULT_ROUTE_ACCESS;
      const map: Record<string, AppRole[]> = { ...DEFAULT_ROUTE_ACCESS };
      for (const row of data as any[]) {
        map[row.route_path] = (row.roles ?? []) as AppRole[];
      }
      return map;
    },
  });
}

export function useRoutePermissions() {
  return useQuery<RoutePermission[]>({
    queryKey: ["role_permissions_full"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("route_path, label, roles")
        .order("route_path");
      if (error) throw new Error(error.message);
      return (data ?? []) as RoutePermission[];
    },
  });
}

export function makeCanAccess(map: Record<string, AppRole[]>) {
  return (path: string, role: EffectiveRole) => {
    const allowed = map[path];
    if (!allowed) return true;
    return allowed.includes(role);
  };
}

/** Hook formátum: canAccess(path, role). DB betöltődéséig a default mátrix érvényes. */
export function useCanAccess() {
  const { data } = usePermissions();
  return makeCanAccess(data ?? DEFAULT_ROUTE_ACCESS);
}

/** Statikus fallback – használd ha hookra nem támaszkodhatsz. */
export function canAccess(path: string, role: EffectiveRole): boolean {
  return makeCanAccess(DEFAULT_ROUTE_ACCESS)(path, role);
}
