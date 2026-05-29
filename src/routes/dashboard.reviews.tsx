import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Check, EyeOff, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/reviews")({
  component: ReviewsPage,
});

function ReviewsPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  const qc = useQueryClient();

  const { data: items } = useQuery({
    queryKey: ["reviews", orgId], enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("reviews").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "pending" | "approved" | "hidden" }) => {
      const { error } = await supabase.from("reviews").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Frissítve"); qc.invalidateQueries({ queryKey: ["reviews", orgId] }); },
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("reviews").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Törölve"); qc.invalidateQueries({ queryKey: ["reviews", orgId] }); },
  });

  if (!orgId) return <p className="text-muted-foreground">Először hozz létre egy üzletet.</p>;

  const avg = items?.length ? (items.reduce((s: number, r: any) => s + r.rating, 0) / items.length).toFixed(1) : "—";

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">Vélemények</h1>
      <p className="text-muted-foreground text-sm mb-6">Átlag: <strong>{avg} ★</strong> · Összesen: {items?.length ?? 0}</p>

      <div className="space-y-3">
        {items?.map((r: any) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <div className="flex">
                  {[1,2,3,4,5].map(n => (
                    <Star key={n} className={`w-4 h-4 ${n <= r.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
                  ))}
                </div>
                <Badge variant={r.status === "approved" ? "default" : r.status === "hidden" ? "outline" : "secondary"}>
                  {r.status === "approved" ? "jóváhagyott" : r.status === "hidden" ? "elrejtve" : "függő"}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleDateString("hu-HU")}
              </div>
            </div>
            {r.comment && <p className="text-sm mb-3">{r.comment}</p>}
            <div className="flex gap-2">
              {r.status !== "approved" && (
                <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: r.id, status: "approved" })}>
                  <Check className="w-3 h-3 mr-1" /> Jóváhagy
                </Button>
              )}
              {r.status !== "hidden" && (
                <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: r.id, status: "hidden" })}>
                  <EyeOff className="w-3 h-3 mr-1" /> Elrejt
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { if (confirm("Törlöd?")) del.mutate(r.id); }}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </Card>
        ))}
        {(items?.length ?? 0) === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            Még nincs vélemény. A foglalás befejezése után az ügyfél értékelhet.
          </Card>
        )}
      </div>
    </div>
  );
}
