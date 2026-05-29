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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/resources")({
  component: ResourcesPage,
});

type Form = { id?: string; name: string; type: string; active: boolean };
const empty: Form = { name: "", type: "room", active: true };

function ResourcesPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);

  const { data: items } = useQuery({
    queryKey: ["resources", orgId], enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("resources").select("*").eq("organization_id", orgId).order("created_at");
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (f: Form) => {
      if (f.id) {
        const { error } = await supabase.from("resources").update({ name: f.name, type: f.type, active: f.active }).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("resources").insert({ organization_id: orgId, name: f.name, type: f.type, active: f.active });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Mentve"); setOpen(false); setForm(empty); qc.invalidateQueries({ queryKey: ["resources", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("resources").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Törölve"); qc.invalidateQueries({ queryKey: ["resources", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!orgId) return <p className="text-muted-foreground">Először hozz létre egy üzletet.</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Erőforrások</h1>
          <p className="text-muted-foreground text-sm">Szobák, eszközök, székek — minden ami foglalható.</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(empty); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Új</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{form.id ? "Erőforrás szerkesztése" : "Új erőforrás"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Név</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div>
                <Label>Típus</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="room">Szoba</SelectItem>
                    <SelectItem value="chair">Szék</SelectItem>
                    <SelectItem value="equipment">Eszköz</SelectItem>
                    <SelectItem value="other">Egyéb</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Aktív</label>
              <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name} className="w-full">Mentés</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {items?.map((r: any) => (
          <Card key={r.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{r.name} {!r.active && <span className="text-xs text-muted-foreground">(inaktív)</span>}</div>
              <div className="text-sm text-muted-foreground">{r.type}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={() => { setForm({ id: r.id, name: r.name, type: r.type, active: r.active }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => { if (confirm("Biztos?")) del.mutate(r.id); }}><Trash2 className="w-4 h-4" /></Button>
            </div>
          </Card>
        ))}
        {(items?.length ?? 0) === 0 && <p className="text-muted-foreground">Még nincs erőforrás.</p>}
      </div>
    </div>
  );
}
