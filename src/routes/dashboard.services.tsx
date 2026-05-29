import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/services")({
  component: ServicesPage,
});

type ServiceForm = {
  id?: string;
  name: string;
  description: string;
  duration_minutes: number;
  price: number;
  deposit_amount: number;
  deposit_required: boolean;
  active: boolean;
};

const empty: ServiceForm = { name: "", description: "", duration_minutes: 30, price: 0, deposit_amount: 0, deposit_required: false, active: true };

function ServicesPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ServiceForm>(empty);

  const { data: services } = useQuery({
    queryKey: ["services", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("services").select("*").eq("organization_id", orgId).order("created_at");
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (f: ServiceForm) => {
      if (f.id) {
        const { error } = await supabase.from("services").update({
          name: f.name, description: f.description, duration_minutes: f.duration_minutes,
          price: f.price, deposit_amount: f.deposit_amount, deposit_required: f.deposit_required, active: f.active,
        }).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("services").insert({
          organization_id: orgId, name: f.name, description: f.description,
          duration_minutes: f.duration_minutes, price: f.price,
          deposit_amount: f.deposit_amount, deposit_required: f.deposit_required, active: f.active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Mentve"); setOpen(false); setForm(empty); qc.invalidateQueries({ queryKey: ["services", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("services").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Törölve"); qc.invalidateQueries({ queryKey: ["services", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!orgId) return <p className="text-muted-foreground">Először rendelj magadhoz egy szervezetet.</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Szolgáltatások</h1>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(empty); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Új</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{form.id ? "Szolgáltatás szerkesztése" : "Új szolgáltatás"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Név</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Leírás</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>Időtartam (perc)</Label><Input type="number" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: +e.target.value })} /></div>
                <div><Label>Ár (Ft)</Label><Input type="number" value={form.price} onChange={e => setForm({ ...form, price: +e.target.value })} /></div>
                <div><Label>Foglaló (Ft)</Label><Input type="number" value={form.deposit_amount} onChange={e => setForm({ ...form, deposit_amount: +e.target.value })} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.deposit_required} onChange={e => setForm({ ...form, deposit_required: e.target.checked })} /> Foglaló kötelező</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Aktív</label>
              <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name} className="w-full">Mentés</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {services?.map((s: any) => (
          <Card key={s.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{s.name} {!s.active && <span className="text-xs text-muted-foreground">(inaktív)</span>}</div>
              <div className="text-sm text-muted-foreground">{s.duration_minutes} perc · {Number(s.price).toLocaleString("hu-HU")} Ft</div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={() => { setForm({ ...s }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => { if (confirm("Biztos?")) del.mutate(s.id); }}><Trash2 className="w-4 h-4" /></Button>
            </div>
          </Card>
        ))}
        {(services?.length ?? 0) === 0 && <p className="text-muted-foreground">Még nincs szolgáltatás.</p>}
      </div>
    </div>
  );
}
