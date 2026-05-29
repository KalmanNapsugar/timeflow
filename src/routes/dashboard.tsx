import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Vezérlőpult" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user, ownedOrgIds, loading } = useAuth();
  const orgId = ownedOrgIds[0];

  const { data: bookings } = useQuery({
    queryKey: ["dash-bookings", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("*, services(name), customers(full_name)")
        .eq("organization_id", orgId)
        .order("start_at", { ascending: true })
        .limit(50);
      return data ?? [];
    },
  });

  if (loading) return <div className="container mx-auto p-10">Betöltés…</div>;
  if (!user) return (
    <div className="container mx-auto p-10 text-center">
      <p className="mb-4">Vezérlőpulthoz be kell jelentkezned.</p>
      <Button asChild><Link to="/login">Bejelentkezés</Link></Button>
    </div>
  );
  if (!orgId) return (
    <div className="container mx-auto p-10 text-center">
      <p className="text-muted-foreground">Nincs tulajdonosi szervezeted. A demo szervezetekhez add hozzá a Cloud admin felületen az owner_id-t.</p>
    </div>
  );

  const today = new Date(); today.setHours(0,0,0,0);
  const todays = (bookings ?? []).filter(b => {
    const d = new Date(b.start_at);
    return d >= today && d < new Date(today.getTime() + 86400000);
  });
  const revenue = (bookings ?? []).filter(b => b.status === "completed").reduce((s, b: any) => s + Number(b.price_total || 0), 0);

  return (
    <div className="min-h-screen container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Vezérlőpult</h1>
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <Card className="p-5 shadow-soft"><div className="text-sm text-muted-foreground">Mai foglalások</div><div className="text-3xl font-bold">{todays.length}</div></Card>
        <Card className="p-5 shadow-soft"><div className="text-sm text-muted-foreground">Összes foglalás</div><div className="text-3xl font-bold">{bookings?.length ?? 0}</div></Card>
        <Card className="p-5 shadow-soft"><div className="text-sm text-muted-foreground">Befejezett bevétel</div><div className="text-3xl font-bold">{revenue.toLocaleString("hu-HU")} Ft</div></Card>
      </div>

      <h2 className="text-xl font-semibold mb-3">Közelgő foglalások</h2>
      <div className="space-y-2">
        {bookings?.slice(0, 20).map((b: any) => (
          <Card key={b.id} className="p-3 flex items-center justify-between text-sm shadow-soft">
            <div>
              <div className="font-medium">{b.services?.name}</div>
              <div className="text-muted-foreground">{b.customers?.full_name} – {new Date(b.start_at).toLocaleString("hu-HU")}</div>
            </div>
            <Badge>{b.status}</Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}
