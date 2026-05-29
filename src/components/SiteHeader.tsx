import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { Home, Search, Calendar, LayoutDashboard, ShieldCheck, LogIn, LogOut, CalendarCheck } from "lucide-react";

export function SiteHeader() {
  const { user, roles, signOut } = useAuth();
  const isAdmin = roles.includes("platform_admin");

  return (
    <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-20">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-2">
        <Link to="/" className="flex items-center gap-2 font-semibold text-lg shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-hero" />
          <span className="hidden sm:inline">IdőpontFlow</span>
        </Link>
        <nav className="flex items-center gap-1 flex-wrap justify-end">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/"><Home className="w-4 h-4" /> <span className="hidden md:inline">Főoldal</span></Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/search"><Search className="w-4 h-4" /> <span className="hidden md:inline">Felfedezés</span></Link>
          </Button>
          {user && (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/my-bookings"><CalendarCheck className="w-4 h-4" /> <span className="hidden md:inline">Foglalásaim</span></Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard/calendar"><Calendar className="w-4 h-4" /> <span className="hidden md:inline">Naptár</span></Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard"><LayoutDashboard className="w-4 h-4" /> <span className="hidden md:inline">Vezérlőpult</span></Link>
              </Button>
            </>
          )}
          {isAdmin && (
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
