import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Calendar, Sparkles, Clock, Shield, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "IdőpontFlow – Foglalj időpontot egyszerűen" },
      { name: "description", content: "Modern időpontfoglaló platform szépségszalonoknak, wellness szolgáltatóknak és tanácsadóknak." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("platform_admin");
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

  return (
    <div className="min-h-screen">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold text-lg">
            <div className="w-8 h-8 rounded-lg bg-gradient-hero" />
            IdőpontFlow
          </Link>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" asChild><Link to="/search">Felfedezés</Link></Button>
            {isAdmin && (
              <Button variant="outline" asChild>
                <Link to="/admin"><ShieldCheck className="w-4 h-4" /> Admin</Link>
              </Button>
            )}
            <Button asChild><Link to="/search">Foglalj most</Link></Button>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-hero opacity-90" />
        <div className="relative container mx-auto px-4 py-24 md:py-32 text-primary-foreground text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Foglalj időpontot<br/>néhány kattintással
          </h1>
          <p className="text-lg md:text-xl opacity-90 max-w-2xl mx-auto mb-8">
            Fedezz fel szépségszalonokat, wellness szolgáltatókat és tanácsadókat. Egyszerű, gyors, biztonságos.
          </p>
          <Button size="lg" variant="secondary" asChild className="shadow-elegant">
            <Link to="/search">Szolgáltatók böngészése</Link>
          </Button>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-4 gap-6 mb-16">
          {[
            { icon: Calendar, title: "Valós idejű naptár", desc: "Csak szabad időpontokat látsz." },
            { icon: Sparkles, title: "Egyszerű foglalás", desc: "5 lépés és kész." },
            { icon: Clock, title: "Emlékeztetők", desc: "Soha nem felejted el." },
            { icon: Shield, title: "Biztonságos", desc: "GDPR-megfelelő adatkezelés." },
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
        © {new Date().getFullYear()} IdőpontFlow MVP
      </footer>
    </div>
  );
}
