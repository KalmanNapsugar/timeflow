import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/my-bookings")({
  head: () => ({ meta: [{ title: "Foglalásaim" }] }),
  component: MyBookings,
});

function MyBookings() {
  const { user, loading } = useAuth();
  const { data } = useQuery({
    queryKey: ["my-bookings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("*, services(name), organizations(name, slug)")
        .eq("customer_auth_user_id", user!.id)
        .order("start_at", { ascending: false });
      return data ?? [];
    },
  });

  if (loading) return <div className="container mx-auto p-10">Betöltés…</div>;
  if (!user) return (
    <div className="container mx-auto p-10 text-center">
      <p className="mb-4">Jelentkezz be a foglalásaid megtekintéséhez.</p>
      <Button asChild><Link to="/login">Bejelentkezés</Link></Button>
    </div>
  );

  return (
    <div className="min-h-screen container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Foglalásaim</h1>
      <div className="space-y-3">
        {data?.length === 0 && <p className="text-muted-foreground">Még nincs foglalásod.</p>}
        {data?.map((b: any) => (
          <Card key={b.id} className="p-4 flex items-center justify-between shadow-soft">
            <div>
              <div className="font-semibold">{b.services?.name}</div>
              <div className="text-sm text-muted-foreground">{b.organizations?.name}</div>
              <div className="text-sm">{new Date(b.start_at).toLocaleString("hu-HU")}</div>
            </div>
            <Badge>{b.status}</Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}
