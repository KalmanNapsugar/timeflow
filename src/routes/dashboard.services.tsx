import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Copy, Pencil, Plus, Trash2, X } from "lucide-react";
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
  tags: string[];
  min_lead_time_minutes: number;
};

const empty: ServiceForm = { name: "", description: "", duration_minutes: 30, price: 0, deposit_amount: 0, deposit_required: false, active: true, tags: [], min_lead_time_minutes: 0 };

function parseTags(input: string): string[] {
  return input.split(",").map(t => t.trim()).filter(Boolean);
}

function ServicesPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ServiceForm>(empty);
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const { data: services } = useQuery({
    queryKey: ["services", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("services").select("*").eq("organization_id", orgId).order("created_at");
      return data ?? [];
    },
  });

  const allTags = useMemo(() => {
    const s = new Set<string>();
    (services ?? []).forEach((sv: any) => (sv.tags ?? []).forEach((t: string) => s.add(t)));
    return [...s].sort();
  }, [services]);

  const filteredServices = useMemo(() => {
    if (tagFilter.length === 0) return services ?? [];
    return (services ?? []).filter((s: any) => {
      const tags: string[] = s.tags ?? [];
      return tagFilter.every(t => tags.includes(t));
    });
  }, [services, tagFilter]);

  const save = useMutation({
    mutationFn: async (f: ServiceForm) => {
      const payload = {
        name: f.name, description: f.description, duration_minutes: f.duration_minutes,
        price: f.price, deposit_amount: f.deposit_amount, deposit_required: f.deposit_required,
        active: f.active, tags: f.tags,
      };
      if (f.id) {
        const { error } = await supabase.from("services").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("services").insert({ organization_id: orgId, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Mentve"); setOpen(false); setForm(empty); qc.invalidateQueries({ queryKey: ["services", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const duplicate = useMutation({
    mutationFn: async (s: any) => {
      const { data: created, error } = await supabase.from("services").insert({
        organization_id: orgId,
        name: `${s.name} (másolat)`,
        description: s.description,
        duration_minutes: s.duration_minutes,
        price: s.price,
        deposit_amount: s.deposit_amount,
        deposit_required: s.deposit_required,
        active: s.active,
        tags: s.tags ?? [],
        category_id: s.category_id ?? null,
        buffer_before_minutes: s.buffer_before_minutes ?? 0,
        buffer_after_minutes: s.buffer_after_minutes ?? 0,
      }).select("*").single();
      if (error) throw error;
      return created;
    },
    onSuccess: (created: any) => {
      toast.success("Lemásolva — most szerkesztheted");
      qc.invalidateQueries({ queryKey: ["services", orgId] });
      setForm({
        id: created.id,
        name: created.name,
        description: created.description ?? "",
        duration_minutes: created.duration_minutes,
        price: Number(created.price),
        deposit_amount: Number(created.deposit_amount),
        deposit_required: created.deposit_required,
        active: created.active,
        tags: created.tags ?? [],
        min_lead_time_minutes: created.min_lead_time_minutes ?? 0,
      });
      setOpen(true);
    },
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
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{form.id ? "Szolgáltatás szerkesztése" : "Új szolgáltatás"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Név</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Leírás</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>Időtartam (perc)</Label><Input type="number" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: +e.target.value })} /></div>
                <div><Label>Ár (Ft)</Label><Input type="number" value={form.price} onChange={e => setForm({ ...form, price: +e.target.value })} /></div>
                <div><Label>Foglaló (Ft)</Label><Input type="number" value={form.deposit_amount} onChange={e => setForm({ ...form, deposit_amount: +e.target.value })} /></div>
              </div>
              <div>
                <Label>Címkék <span className="text-xs text-muted-foreground">(vesszővel elválasztva)</span></Label>
                <Input
                  value={form.tags.join(", ")}
                  onChange={e => setForm({ ...form, tags: parseTags(e.target.value) })}
                  placeholder="pl. népszerű, akció, női"
                />
                <div className="flex flex-wrap gap-1 mt-1">
                  {form.tags.map(t => <Badge key={t} variant="secondary">{t}</Badge>)}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.deposit_required} onChange={e => setForm({ ...form, deposit_required: e.target.checked })} /> Foglaló kötelező</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Aktív</label>
              <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name} className="w-full">Mentés</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {allTags.length > 0 && (
        <Card className="p-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium mr-1">Szűrés címkékre:</span>
            {allTags.map(t => {
              const active = tagFilter.includes(t);
              return (
                <button key={t}
                  onClick={() => setTagFilter(active ? tagFilter.filter(x => x !== t) : [...tagFilter, t])}>
                  <Badge variant={active ? "default" : "outline"} className="cursor-pointer">{t}</Badge>
                </button>
              );
            })}
            {tagFilter.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setTagFilter([])}><X className="w-3 h-3 mr-1" />Szűrő törlése</Button>
            )}
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {filteredServices?.map((s: any) => (
          <Card key={s.id} className="p-4 flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{s.name} {!s.active && <span className="text-xs text-muted-foreground">(inaktív)</span>}</div>
              <div className="text-sm text-muted-foreground">{s.duration_minutes} perc · {Number(s.price).toLocaleString("hu-HU")} Ft</div>
              {(s.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {s.tags.map((t: string) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                </div>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <Button variant="ghost" size="icon" title="Másolás" onClick={() => duplicate.mutate(s)}><Copy className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" title="Szerkesztés" onClick={() => {
                setForm({
                  id: s.id, name: s.name, description: s.description ?? "",
                  duration_minutes: s.duration_minutes, price: Number(s.price),
                  deposit_amount: Number(s.deposit_amount), deposit_required: s.deposit_required,
                  active: s.active, tags: s.tags ?? [],
                });
                setOpen(true);
              }}><Pencil className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" title="Törlés" onClick={() => { if (confirm("Biztos?")) del.mutate(s.id); }}><Trash2 className="w-4 h-4" /></Button>
            </div>
          </Card>
        ))}
        {(filteredServices?.length ?? 0) === 0 && <p className="text-muted-foreground">{tagFilter.length > 0 ? "Nincs egyező szolgáltatás a szűrőre." : "Még nincs szolgáltatás."}</p>}
      </div>
    </div>
  );
}
