import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { claimDemoOrg } from "@/lib/orgs.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardIndex,
});

function DashboardIndex() {
  const { user, ownedOrgIds } = useAuth();
  const qc = useQueryClient();
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

  const claim = useMutation({
    mutationFn: (slug: string) => claimDemoOrg({ data: { slug } }),
    onSuccess: async () => {
      toast.success("Demo szervezet hozzád rendelve!");
      await qc.invalidateQueries();
      window.location.reload();
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!orgId) return <ClaimDemo onClaim={(s) => claim.mutate(s)} loading={claim.isPending} />;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todays = (bookings ?? []).filter((b: any) => {
    const d = new Date(b.start_at);
    return d >= today && d < new Date(today.getTime() + 86400000);
  });
  const revenue = (bookings ?? []).filter((b: any) => b.status === "completed").reduce((s: number, b: any) => s + Number(b.price_total || 0), 0);

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Áttekintés</h1>
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <Card className="p-5"><div className="text-sm text-muted-foreground">Mai foglalások</div><div className="text-3xl font-bold">{todays.length}</div></Card>
        <Card className="p-5"><div className="text-sm text-muted-foreground">Összes foglalás</div><div className="text-3xl font-bold">{bookings?.length ?? 0}</div></Card>
        <Card className="p-5"><div className="text-sm text-muted-foreground">Befejezett bevétel</div><div className="text-3xl font-bold">{revenue.toLocaleString("hu-HU")} Ft</div></Card>
      </div>

      <h2 className="text-xl font-semibold mb-3">Közelgő foglalások</h2>
      <div className="space-y-2">
        {bookings?.slice(0, 20).map((b: any) => (
          <Card key={b.id} className="p-3 flex items-center justify-between text-sm">
            <div>
              <div className="font-medium">{b.services?.name}</div>
              <div className="text-muted-foreground">{b.customers?.full_name} – {new Date(b.start_at).toLocaleString("hu-HU")}</div>
            </div>
            <Badge>{b.status}</Badge>
          </Card>
        ))}
        {(bookings?.length ?? 0) === 0 && <p className="text-muted-foreground">Még nincsenek foglalások.</p>}
      </div>
    </div>
  );
}

function ClaimDemo({ onClaim, loading }: { onClaim: (slug: string) => void; loading: boolean }) {
  const [slug, setSlug] = useState("luna-beauty");
  return (
    <div className="max-w-xl">
      <h1 className="text-3xl font-bold mb-3">Üdv a Vezérlőpulton!</h1>
      <p className="text-muted-foreground mb-6">
        Még nincs saját szervezeted. Tesztelési célból átveheted az egyik demo szervezet tulajdonjogát.
      </p>
      <Card className="p-6 space-y-4">
        <div className="space-y-2">
          <Button variant={slug === "luna-beauty" ? "default" : "outline"} onClick={() => setSlug("luna-beauty")} className="w-full justify-start">
            Luna Beauty (luna-beauty)
          </Button>
          <Button variant={slug === "nyugalom-wellness" ? "default" : "outline"} onClick={() => setSlug("nyugalom-wellness")} className="w-full justify-start">
            Nyugalom Wellness (nyugalom-wellness)
          </Button>
        </div>
        <Button onClick={() => onClaim(slug)} disabled={loading} className="w-full">
          {loading ? "..." : "Tulajdonosi átvétel"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Csak akkor sikerül, ha még senki sem vette át. Éles használathoz ne használd!
        </p>
      </Card>
    </div>
  );
}
