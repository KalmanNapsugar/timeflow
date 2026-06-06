import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Calendar, Sparkles, Clock, Shield, ShieldCheck, LayoutDashboard, LogIn, CalendarCheck, Store } from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TimeFlow – Online foglalási rendszer kisvállalkozásoknak" },
      { name: "description", content: "Fogadj online foglalásokat, kezeld a naptárad, munkatársaid, szolgáltatásaid és ügyfeleidet egy egyszerű felületről. Szalonoknak, wellness-, edzői, oktatói és tanácsadói szolgáltatóknak." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { user, effectiveRole } = useAuth();
  const { data: orgs } = useQuery({
    queryKey: ["orgs-featured"],
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("id, name, slug, description, cover_url")
        .eq("public_profile_enabled", true)
        .limit(6);
      return data ?? [];
    },
  });

  // Szerepkör-érzékeny gyors-műveletek
  type QuickAction = { to: string; label: string; icon: typeof Calendar; variant?: "default" | "secondary" | "outline" };
  const quickActions: QuickAction[] = (() => {
    if (effectiveRole === "platform_admin") return [
      { to: "/admin", label: "Admin felület", icon: ShieldCheck, variant: "secondary" },
      { to: "/dashboard", label: "Vezérlőpult", icon: LayoutDashboard, variant: "outline" },
      { to: "/search", label: "Böngészés", icon: Sparkles, variant: "outline" },
    ];
    if (effectiveRole === "owner" || effectiveRole === "staff") return [
      { to: "/dashboard", label: "Vezérlőpult", icon: LayoutDashboard, variant: "secondary" },
      { to: "/dashboard/calendar", label: "Naptár", icon: Calendar, variant: "outline" },
      { to: "/my-bookings", label: "Foglalásaim", icon: CalendarCheck, variant: "outline" },
    ];
    if (effectiveRole === "customer") return [
      { to: "/search", label: "Szolgáltatók böngészése", icon: Sparkles, variant: "secondary" },
      { to: "/my-bookings", label: "Foglalásaim", icon: CalendarCheck, variant: "outline" },
      { to: "/organizations/new", label: "Indítsd el saját üzleted", icon: Store, variant: "outline" },
    ];
    // guest
    return [
      { to: "/search", label: "Szolgáltatók böngészése", icon: Sparkles, variant: "secondary" },
      { to: "/login", label: "Belépés / Regisztráció", icon: LogIn, variant: "outline" },
    ];
  })();

  const greeting = !user
    ? "Üdv! Böngéssz vendégként, vagy regisztrálj több lehetőségért."
    : effectiveRole === "customer"
      ? "Üdv újra! Itt a gyors elérésed."
      : effectiveRole === "owner" || effectiveRole === "staff"
        ? "Üzleti felület gyors elérése."
        : effectiveRole === "platform_admin"
          ? "Platform admin gyors elérés."
          : "";

  return (
    <div className="min-h-screen">

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-hero opacity-90" />
        <div className="relative container mx-auto px-4 py-24 md:py-32 text-primary-foreground text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Online foglalások<br/>egyszerűen
          </h1>
          <p className="text-lg md:text-xl opacity-90 max-w-2xl mx-auto mb-3">
            Fogadj online foglalásokat, kezeld a naptárad, munkatársaid, szolgáltatásaid és ügyfeleidet egy egyszerű felületről.
          </p>
          <p className="text-sm md:text-base opacity-80 max-w-2xl mx-auto mb-6">
            {greeting || "Szalonoknak, kozmetikusoknak, wellness szolgáltatóknak, edzőknek, tanácsadóknak, oktatóknak és kis rendelőknek."}
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            {quickActions.map((a) => {
              const variant = a.variant ?? "secondary";
              // outline gomb a színes hero-n: kényszerített olvasható szín
              const colorFix = variant === "outline" ? "text-foreground hover:text-accent-foreground" : "";
              return (
                <Button key={a.to} size="lg" variant={variant} asChild className={`shadow-elegant ${colorFix}`}>
                  <Link to={a.to}><a.icon className="w-4 h-4" /> {a.label}</Link>
                </Button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-4 gap-6 mb-16">
          {[
            { icon: Calendar, title: "Online naptár", desc: "Az ügyfelek a szabad időpontokat látják valós időben." },
            { icon: Sparkles, title: "Egyszerű foglalás", desc: "Szolgáltatás, munkatárs, időpont – néhány kattintás." },
            { icon: Clock, title: "Automatikus emlékeztetők", desc: "Kevesebb elmaradt időpont e-mailes értesítőkkel." },
            { icon: Shield, title: "Biztonságos & GDPR", desc: "Ügyféladatok és fizetés biztonságos kezelése." },
          ].map((f) => (
            <Card key={f.title} className="p-6 bg-gradient-card shadow-soft">
              <f.icon className="w-8 h-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </Card>
          ))}
        </div>

        <h2 className="text-3xl font-bold mb-8">Kiemelt szolgáltatók</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {orgs?.map((o) => (
            <Link key={o.id} to="/provider/$slug" params={{ slug: o.slug }}>
              <Card className="overflow-hidden shadow-soft hover:shadow-elegant transition-shadow">
                <div className="h-40 bg-muted bg-cover bg-center" style={{ backgroundImage: o.cover_url ? `url(${o.cover_url})` : undefined }} />
                <div className="p-5">
                  <h3 className="font-semibold text-lg mb-1">{o.name}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2">{o.description}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <footer className="border-t mt-16 py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} TimeFlow MVP
      </footer>
    </div>
  );
}
