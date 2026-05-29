import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/provider/$slug")({
  head: () => ({ meta: [{ title: "Szolgáltató – IdőpontFlow" }] }),
  component: ProviderPage,
});

function ProviderPage() {
  const { slug } = Route.useParams();
  const { data } = useQuery({
    queryKey: ["provider", slug],
    queryFn: async () => {
      const { data: org } = await supabase
        .from("organizations").select("*").eq("slug", slug).maybeSingle();
      if (!org) return null;
      const [{ data: services }, { data: staff }, { data: cats }] = await Promise.all([
        supabase.from("services").select("*").eq("organization_id", org.id).eq("active", true),
        supabase.from("staff_profiles").select("*").eq("organization_id", org.id).eq("active", true),
        supabase.from("service_categories").select("*").eq("organization_id", org.id).order("sort_order"),
      ]);
      return { org, services: services ?? [], staff: staff ?? [], cats: cats ?? [] };
    },
  });

  if (!data) return <div className="container mx-auto p-10">Betöltés…</div>;
  const { org, services, staff, cats } = data;

  return (
    <div className="min-h-screen">
      <div className="h-64 bg-muted bg-cover bg-center" style={{ backgroundImage: org.cover_url ? `url(${org.cover_url})` : undefined }} />
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">{org.name}</h1>
            <p className="text-muted-foreground max-w-2xl">{org.description}</p>
          </div>
          <Button size="lg" asChild><Link to="/book/$slug" params={{ slug: org.slug }}>Foglalás</Link></Button>
        </div>

        <h2 className="text-2xl font-semibold mb-4">Munkatársak</h2>
        <div className="grid md:grid-cols-3 gap-4 mb-10">
          {staff.map((s) => (
            <Card key={s.id} className="p-4 flex items-center gap-4 shadow-soft">
              {s.avatar_url && <img src={s.avatar_url} alt={s.display_name} className="w-14 h-14 rounded-full object-cover" />}
              <div>
                <div className="font-semibold">{s.display_name}</div>
                <div className="text-sm text-muted-foreground">{s.bio}</div>
              </div>
            </Card>
          ))}
        </div>

        <h2 className="text-2xl font-semibold mb-4">Szolgáltatások</h2>
        {cats.map((c) => (
          <div key={c.id} className="mb-8">
            <h3 className="text-lg font-medium mb-3">{c.name}</h3>
            <div className="grid md:grid-cols-2 gap-3">
              {services.filter(s => s.category_id === c.id).map(s => (
                <Card key={s.id} className="p-4 flex items-center justify-between shadow-soft">
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-sm text-muted-foreground">{s.description}</div>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="secondary">{s.duration_minutes} perc</Badge>
                      {s.deposit_required && <Badge variant="outline">Előleg: {s.deposit_amount} Ft</Badge>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg">{Number(s.price).toLocaleString("hu-HU")} Ft</div>
                    <Button size="sm" className="mt-2" asChild>
                      <Link to="/book/$slug" params={{ slug: org.slug }} search={{ service: s.id }}>Foglalás</Link>
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
