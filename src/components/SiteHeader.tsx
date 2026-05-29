import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { Home, Search, Calendar, LayoutDashboard, ShieldCheck, LogIn, LogOut, CalendarCheck, Store } from "lucide-react";

export function SiteHeader() {
  const { user, effectiveRole, signOut } = useAuth();

  const show = (path: string) => canAccess(path, effectiveRole);

  return (
    <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-20">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-2">
        <Link to="/" className="flex items-center gap-2 font-semibold text-lg shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-hero" />
          <span className="hidden sm:inline">IdőpontFlow</span>
        </Link>
        <nav className="flex items-center gap-1 flex-wrap justify-end">
          {show("/") && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/"><Home className="w-4 h-4" /> <span className="hidden md:inline">Főoldal</span></Link>
            </Button>
          )}
          {show("/search") && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/search"><Search className="w-4 h-4" /> <span className="hidden md:inline">Felfedezés</span></Link>
            </Button>
          )}
          {user && show("/my-bookings") && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/my-bookings"><CalendarCheck className="w-4 h-4" /> <span className="hidden md:inline">Foglalásaim</span></Link>
            </Button>
          )}
          {user && show("/dashboard/calendar") && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard/calendar"><Calendar className="w-4 h-4" /> <span className="hidden md:inline">Naptár</span></Link>
            </Button>
          )}
          {user && show("/dashboard") && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard"><LayoutDashboard className="w-4 h-4" /> <span className="hidden md:inline">Vezérlőpult</span></Link>
            </Button>
          )}
          {user && show("/organizations/new") && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/organizations/new"><Store className="w-4 h-4" /> <span className="hidden md:inline">Új üzlet</span></Link>
            </Button>
          )}
          {show("/admin") && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin"><ShieldCheck className="w-4 h-4" /> <span className="hidden md:inline">Admin</span></Link>
            </Button>
          )}
          {user ? (
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              <LogOut className="w-4 h-4" /> <span className="hidden md:inline">Kilépés</span>
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link to="/login"><LogIn className="w-4 h-4" /> <span className="hidden md:inline">Belépés</span></Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
