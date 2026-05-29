import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Calendar, LayoutDashboard, Scissors, Users, UserCog, LogOut, Home } from "lucide-react";
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
];

function DashboardLayout() {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading) return <div className="container mx-auto p-10">Betöltés…</div>;
  if (!user) return (
    <div className="container mx-auto p-10 text-center">
      <p className="mb-4">Vezérlőpulthoz be kell jelentkezned.</p>
      <Button asChild><Link to="/login">Bejelentkezés</Link></Button>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="md:w-60 border-b md:border-b-0 md:border-r bg-muted/30 p-4 md:p-6 md:min-h-screen">
        <Link to="/" className="font-bold text-lg block mb-6">IdőpontFlow</Link>
        <nav className="flex md:flex-col gap-1 overflow-x-auto">
          {nav.map(({ to, label, icon: Icon, exact }) => {
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
        <Button variant="ghost" size="sm" className="mt-6 w-full justify-start gap-2" onClick={() => signOut()}>
          <LogOut className="w-4 h-4" /> Kijelentkezés
        </Button>
      </aside>
      <main className="flex-1 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
