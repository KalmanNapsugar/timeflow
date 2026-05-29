import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Minus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/inventory")({
  component: InventoryPage,
});

function InventoryPage() {
  const { ownedOrgIds, user } = useAuth();
  const orgId = ownedOrgIds[0];
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", sku: "", quantity: 0, unit: "db", low_stock_threshold: 5 });

  const { data: items } = useQuery({
    queryKey: ["inventory", orgId], enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("inventory_items").select("*").eq("organization_id", orgId).order("name");
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("inventory_items").insert({ organization_id: orgId, ...form });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mentve"); setOpen(false); qc.invalidateQueries({ queryKey: ["inventory", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const adjust = useMutation({
    mutationFn: async ({ item, delta, reason }: { item: any; delta: number; reason: string }) => {
      const newQty = Number(item.quantity) + delta;
      const { error: e1 } = await supabase.from("inventory_items").update({ quantity: newQty }).eq("id", item.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("inventory_movements").insert({
        item_id: item.id, organization_id: orgId, delta, reason, created_by: user?.id,
      });
      if (e2) throw e2;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory", orgId] }),
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("inventory_items").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory", orgId] }),
  });

  if (!orgId) return <p className="text-muted-foreground">Először hozz létre egy üzletet.</p>;

  const lowStock = items?.filter((i: any) => Number(i.quantity) <= Number(i.low_stock_threshold)).length ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Készlet</h1>
          <p className="text-muted-foreground text-sm">
            Termékek és anyagok nyilvántartása. {lowStock > 0 && <span className="text-destructive">⚠ {lowStock} termék alacsony készleten</span>}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Új termék</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Új készlet termék</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Név</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>SKU</Label><Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></div>
                <div><Label>Mértékegység</Label><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Mennyiség</Label><Input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: +e.target.value })} /></div>
                <div><Label>Alacsony készlet küszöb</Label><Input type="number" value={form.low_stock_threshold} onChange={e => setForm({ ...form, low_stock_threshold: +e.target.value })} /></div>
              </div>
              <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name} className="w-full">Mentés</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {items?.map((it: any) => {
          const low = Number(it.quantity) <= Number(it.low_stock_threshold);
          return (
            <Card key={it.id} className="p-4 flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{it.name}</span>
                  {it.sku && <span className="text-xs text-muted-foreground">({it.sku})</span>}
                  {low && <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />alacsony</Badge>}
                </div>
                <div className="text-sm text-muted-foreground">
                  <strong>{it.quantity}</strong> {it.unit} · küszöb: {it.low_stock_threshold}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" onClick={() => adjust.mutate({ item: it, delta: -1, reason: "manual decrement" })}>
                  <Minus className="w-3 h-3" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => adjust.mutate({ item: it, delta: 1, reason: "manual increment" })}>
                  <Plus className="w-3 h-3" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => { if (confirm("Törlöd?")) del.mutate(it.id); }}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </Card>
          );
        })}
        {(items?.length ?? 0) === 0 && <p className="text-muted-foreground">Még nincs termék.</p>}
      </div>
    </div>
  );
}
