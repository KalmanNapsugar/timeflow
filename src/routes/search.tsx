import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/search")({
  head: () => ({ meta: [{ title: "Szolgáltatók – TimeFlow" }] }),
  component: Search,
});

function Search() {
  const { data: orgs } = useQuery({
    queryKey: ["orgs-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("id, name, slug, description, cover_url")
        .eq("public_profile_enabled", true);
      return data ?? [];
    },
  });

  return (
    <div className="min-h-screen container mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Szolgáltatók</h1>
        <Button variant="outline" asChild><Link to="/">Vissza</Link></Button>
      </div>
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
    </div>
  );
}
