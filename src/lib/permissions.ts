import type { AppRole } from "@/lib/auth";

/** Egy felhasználó "effektív" szerepköre — a legmagasabb jogkör nyer. */
export type EffectiveRole = AppRole;

const RANK: Record<AppRole, number> = {
  guest: 0,
  staff: 1,
  owner: 2,
  platform_admin: 3,
};

export function highestRole(roles: AppRole[], ownedOrgIds: string[] = []): EffectiveRole {
  const all = new Set<AppRole>(roles);
  if (ownedOrgIds.length > 0) all.add("owner");
  if (all.size === 0) all.add("guest");
  return [...all].sort((a, b) => RANK[b] - RANK[a])[0];
}

/** Útvonal-szintű hozzáférés. true = látható/elérhető. */
export const ROUTE_ACCESS: Record<string, AppRole[]> = {
  // Publikus
  "/": ["guest", "staff", "owner", "platform_admin"],
  "/search": ["guest", "staff", "owner", "platform_admin"],
  "/login": ["guest", "staff", "owner", "platform_admin"],

  // Bejelentkezett ügyfél felület
  "/my-bookings": ["staff", "owner", "platform_admin", "guest"], // guest = bejelentkezett, role nélküli
  "/organizations/new": ["staff", "owner", "platform_admin", "guest"],

  // Vezérlőpult — csak owner+
  "/dashboard": ["owner", "platform_admin", "staff"],
  "/dashboard/calendar": ["owner", "platform_admin", "staff"],
  "/dashboard/customers": ["owner", "platform_admin", "staff"],
  "/dashboard/services": ["owner", "platform_admin"],
  "/dashboard/staff": ["owner", "platform_admin"],
  "/dashboard/resources": ["owner", "platform_admin"],
  "/dashboard/marketing": ["owner", "platform_admin"],
  "/dashboard/reviews": ["owner", "platform_admin"],
  "/dashboard/reports": ["owner", "platform_admin"],
  "/dashboard/inventory": ["owner", "platform_admin", "staff"],
  "/dashboard/settings": ["owner", "platform_admin"],
  "/dashboard/audit-log": ["owner", "platform_admin"],
  "/dashboard/ai-assistant": ["owner", "platform_admin"],

  // Csak platform admin
  "/admin": ["platform_admin"],
};

export function canAccess(path: string, role: EffectiveRole): boolean {
  const allowed = ROUTE_ACCESS[path];
  if (!allowed) return true; // ismeretlen útvonalat ne tiltsunk feleslegesen
  return allowed.includes(role);
}

export const ROLE_LABEL: Record<AppRole, string> = {
  guest: "Vendég / ügyfél",
  staff: "Alkalmazott",
  owner: "Üzlet tulajdonos",
  platform_admin: "Platform admin",
};
