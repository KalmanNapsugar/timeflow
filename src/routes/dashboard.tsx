import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useCanAccess, ROLE_LABEL } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, LayoutDashboard, Scissors, Users, UserCog, LogOut, Home, Boxes, Megaphone, Star, BarChart3, Settings, Package2, FileClock, Sparkles, Lock, Mail, Eye, FileSpreadsheet, PieChart, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Vezérlőpult" }] }),
  component: DashboardLayout,
});

const nav = [
  { to: "/dashboard", label: "Áttekintés", icon: LayoutDashboard, exact: true },
  { to: "/dashboard/calendar", label: "Naptár", icon: Calendar },
  { to: "/dashboard/services", label: "Szolgáltatások", icon: Scissors },
  { to: "/dashboard/staff", label: "Munkatársak", icon: UserCog },
  { to: "/dashboard/customers", label: "Ügyfelek", icon: Users },
  { to: "/dashboard/resources", label: "Erőforrások", icon: Boxes },
  { to: "/dashboard/my-availability", label: "Saját rendelkezésre állásom", icon: CalendarClock },
  { to: "/dashboard/exports", label: "Excel export / Import", icon: FileSpreadsheet },
  { to: "/dashboard/stats", label: "Statisztikák", icon: PieChart },
  { to: "/dashboard/marketing", label: "Marketing", icon: Megaphone },
  { to: "/dashboard/reviews", label: "Vélemények", icon: Star },
  { to: "/dashboard/reports", label: "Riportok", icon: BarChart3 },
  { to: "/dashboard/inventory", label: "Készlet", icon: Package2 },
  { to: "/dashboard/email-settings", label: "Kimenő e-mailek", icon: Mail },
  { to: "/dashboard/settings", label: "Beállítások", icon: Settings },
  { to: "/dashboard/audit-log", label: "Audit napló", icon: FileClock },
  { to: "/dashboard/ai-assistant", label: "AI asszisztens", icon: Sparkles },
];


function DashboardLayout() {
  const { user, loading, signOut, effectiveRole, readOnly, realRoles, impersonatedRole, setImpersonatedRole, viewingOrgId, setViewingOrgId } = useAuth();
  const canAccess = useCanAccess();
  const location = useLocation();

  if (loading) return <div className="container mx-auto p-10">Betöltés…</div>;
  if (!user) return (
    <div className="container mx-auto p-10 text-center">
      <p className="mb-4">Vezérlőpulthoz be kell jelentkezned.</p>
      <Button asChild><Link to="/login">Bejelentkezés</Link></Button>
    </div>
  );

  const isRealAdmin = realRoles.includes("platform_admin");
  const canSeeDashboard = canAccess("/dashboard", effectiveRole);
  const canSeeCurrent = canAccess(location.pathname, effectiveRole);

  if (!canSeeDashboard) {
    return (
      <div className="container mx-auto p-10 text-center">
        <Lock className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <h1 className="text-xl font-semibold mb-2">Nincs hozzáférésed a vezérlőpulthoz</h1>
        <p className="text-muted-foreground mb-4">
          Jelenlegi szerepkör: <Badge variant="outline">{ROLE_LABEL[effectiveRole]}</Badge>.
          A vezérlőpult üzlet tulajdonosoknak és alkalmazottaknak érhető el.
        </p>
        <div className="flex gap-2 justify-center flex-wrap">
          {isRealAdmin && (impersonatedRole || viewingOrgId) && (
            <Button onClick={() => { setImpersonatedRole(null); setViewingOrgId(null); }}>
              Vissza admin nézetbe
            </Button>
          )}
          <Button variant="outline" asChild><Link to="/">Vissza a főoldalra</Link></Button>
          <Button variant="outline" asChild><Link to="/organizations/new">Új üzlet létrehozása</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="md:w-60 border-b md:border-b-0 md:border-r bg-muted/30 p-4 md:p-6 md:min-h-screen">
        <Link to="/" className="font-bold text-lg block mb-1">TimeFlow</Link>
        <div className="mb-6 text-xs text-muted-foreground">{ROLE_LABEL[effectiveRole]}</div>
        <nav className="flex md:flex-col gap-1 overflow-x-auto">
          {nav.filter(n => canAccess(n.to, effectiveRole)).map(({ to, label, icon: Icon, exact }) => {
            const active = exact ? location.pathname === to : location.pathname.startsWith(to);
            return (
              <Link key={to} to={to} className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors",
                active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              )}>
                <Icon className="w-4 h-4" /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 space-y-1">
          <Button variant="ghost" size="sm" asChild className="w-full justify-start gap-2">
            <Link to="/"><Home className="w-4 h-4" /> Főoldal</Link>
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => signOut()}>
            <LogOut className="w-4 h-4" /> Kijelentkezés
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-8">
        {readOnly && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            <Eye className="w-4 h-4 shrink-0" />
            <span>Csak betekintés mód — platform adminisztrátorként egy idegen üzletet nézel. Szerkesztés nem engedélyezett.</span>
          </div>
        )}

        {canSeeCurrent ? (
          readOnly ? (
            <fieldset disabled className="m-0 p-0 border-0 min-w-0 [&_a]:pointer-events-auto">
              <Outlet />
            </fieldset>
          ) : <Outlet />
        ) : (
          <div className="p-10 text-center">
            <Lock className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-1">Ehhez az oldalhoz nincs jogosultságod</h2>
            <p className="text-muted-foreground text-sm">
              A(z) <Badge variant="outline">{ROLE_LABEL[effectiveRole]}</Badge> szerepkör nem fér hozzá ehhez a szakaszhoz.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
