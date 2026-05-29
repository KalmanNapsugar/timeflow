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

export const Route = createFileRoute("/dashboard/staff")({
  component: StaffPage,
});

type Form = { id?: string; display_name: string; bio: string; active: boolean };
const empty: Form = { display_name: "", bio: "", active: true };

function StaffPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);

  const { data: staff } = useQuery({
    queryKey: ["staff", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("staff_profiles").select("*").eq("organization_id", orgId).order("created_at");
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (f: Form) => {
      if (f.id) {
        const { error } = await supabase.from("staff_profiles").update({ display_name: f.display_name, bio: f.bio, active: f.active }).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("staff_profiles").insert({ organization_id: orgId, display_name: f.display_name, bio: f.bio, active: f.active });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Mentve"); setOpen(false); setForm(empty); qc.invalidateQueries({ queryKey: ["staff", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_profiles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Törölve"); qc.invalidateQueries({ queryKey: ["staff", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!orgId) return <p className="text-muted-foreground">Először rendelj magadhoz egy szervezetet.</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Munkatársak</h1>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(empty); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Új</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{form.id ? "Szerkesztés" : "Új munkatárs"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Név</Label><Input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} /></div>
              <div><Label>Bemutatkozás</Label><Textarea value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Aktív</label>
              <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.display_name} className="w-full">Mentés</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {staff?.map((s: any) => (
          <Card key={s.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{s.display_name} {!s.active && <span className="text-xs text-muted-foreground">(inaktív)</span>}</div>
              <div className="text-sm text-muted-foreground line-clamp-1">{s.bio}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={() => { setForm({ id: s.id, display_name: s.display_name, bio: s.bio ?? "", active: s.active }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => { if (confirm("Biztos?")) del.mutate(s.id); }}><Trash2 className="w-4 h-4" /></Button>
            </div>
          </Card>
        ))}
        {(staff?.length ?? 0) === 0 && <p className="text-muted-foreground">Még nincs munkatárs.</p>}
      </div>
    </div>
  );
}
