import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/book/confirmed/$bookingId")({
  head: () => ({ meta: [{ title: "Foglalás megerősítve" }] }),
  component: Confirmed,
});

function Confirmed() {
  const { bookingId } = Route.useParams();
  const { data } = useQuery({
    queryKey: ["booking", bookingId],
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("*, services(name, price), organizations(name, slug)")
        .eq("id", bookingId).maybeSingle();
      return data;
    },
  });

  return (
    <div className="min-h-screen container mx-auto px-4 py-16 max-w-lg">
      <Card className="p-8 text-center shadow-elegant">
        <CheckCircle2 className="w-16 h-16 text-success mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Foglalás megerősítve!</h1>
        <p className="text-muted-foreground mb-6">E-mailen elküldtük a részleteket (mock).</p>
        {data && (
          <div className="text-left bg-secondary rounded-lg p-4 mb-6 text-sm">
            <div><strong>{(data as any).services?.name}</strong></div>
            <div>{(data as any).organizations?.name}</div>
            <div>{new Date(data.start_at).toLocaleString("hu-HU")}</div>
          </div>
        )}
        <div className="flex gap-2 justify-center">
          <Button asChild><Link to="/my-bookings">Foglalásaim</Link></Button>
          <Button variant="outline" asChild><Link to="/">Főoldal</Link></Button>
        </div>
      </Card>
    </div>
  );
}
