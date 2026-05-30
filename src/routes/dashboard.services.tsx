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
import { Checkbox } from "@/components/ui/checkbox";
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

function TagCatalogPicker({ orgId, selected, onChange }: { orgId: string; selected: string[]; onChange: (tags: string[]) => void }) {
  const qc = useQueryClient();
  const [newTag, setNewTag] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data: tags } = useQuery({
    queryKey: ["service_tags", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("service_tags").select("*").eq("organization_id", orgId).order("name");
      return data ?? [];
    },
  });

  const addTag = useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const { error } = await supabase.from("service_tags").insert({ organization_id: orgId, name: trimmed });
      if (error && !error.message.includes("duplicate")) throw error;
      return trimmed;
    },
    onSuccess: (name) => {
      qc.invalidateQueries({ queryKey: ["service_tags", orgId] });
      if (name && !selected.includes(name)) onChange([...selected, name]);
      setNewTag("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const renameTag = useMutation({
    mutationFn: async ({ id, oldName, newName }: { id: string; oldName: string; newName: string }) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return null;
      const { error } = await supabase.from("service_tags").update({ name: trimmed }).eq("id", id);
      if (error) throw error;
      // Frissítsük az összes szolgáltatás tags tömbjében
      const { data: svcs } = await supabase.from("services").select("id, tags").eq("organization_id", orgId);
      for (const s of svcs ?? []) {
        const t: string[] = s.tags ?? [];
        if (t.includes(oldName)) {
          const next = t.map(x => x === oldName ? trimmed : x);
          await supabase.from("services").update({ tags: next }).eq("id", s.id);
        }
      }
      return { oldName, trimmed };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["service_tags", orgId] });
      qc.invalidateQueries({ queryKey: ["services", orgId] });
      if (res) onChange(selected.map(x => x === res.oldName ? res.trimmed : x));
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteTag = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("service_tags").delete().eq("id", id);
      if (error) throw error;
      const { data: svcs } = await supabase.from("services").select("id, tags").eq("organization_id", orgId);
      for (const s of svcs ?? []) {
        const t: string[] = s.tags ?? [];
        if (t.includes(name)) {
          await supabase.from("services").update({ tags: t.filter(x => x !== name) }).eq("id", s.id);
        }
      }
      return name;
    },
    onSuccess: (name) => {
      qc.invalidateQueries({ queryKey: ["service_tags", orgId] });
      qc.invalidateQueries({ queryKey: ["services", orgId] });
      onChange(selected.filter(x => x !== name));
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter(x => x !== name) : [...selected, name]);
  };

  return (
    <div className="space-y-2">
      <Label>Címkék</Label>
      <div className="border rounded-md p-2 space-y-1 max-h-48 overflow-y-auto">
        {(tags ?? []).length === 0 && <p className="text-xs text-muted-foreground">Még nincs címke.</p>}
        {(tags ?? []).map((t: any) => (
          <div key={t.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(t.name)} onCheckedChange={() => toggle(t.name)} />
            {editing === t.id ? (
              <>
                <Input value={editValue} onChange={e => setEditValue(e.target.value)} className="h-7 flex-1" />
                <Button size="sm" variant="ghost" onClick={() => renameTag.mutate({ id: t.id, oldName: t.name, newName: editValue })}>OK</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Mégse</Button>
              </>
            ) : (
              <>
                <span className="flex-1 cursor-pointer" onClick={() => toggle(t.name)}>{t.name}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditing(t.id); setEditValue(t.name); }}><Pencil className="w-3 h-3" /></Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { if (confirm(`Törlöd: "${t.name}"?`)) deleteTag.mutate({ id: t.id, name: t.name }); }}><Trash2 className="w-3 h-3" /></Button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input placeholder="Új címke neve" value={newTag} onChange={e => setNewTag(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag.mutate(newTag); } }} />
        <Button type="button" onClick={() => addTag.mutate(newTag)} disabled={!newTag.trim()}>Hozzáad</Button>
      </div>
    </div>
  );
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
        active: f.active, tags: f.tags, min_lead_time_minutes: f.min_lead_time_minutes,
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
                <Label>Min. előre-bejelentkezés (perc)</Label>
                <Input type="number" min={0} value={form.min_lead_time_minutes}
                  onChange={e => setForm({ ...form, min_lead_time_minutes: Math.max(0, +e.target.value || 0) })} />
                <p className="text-xs text-muted-foreground mt-1">0 = nincs korlát. A foglalási rendszer a szolgáltatás és az alkalmazott közül a nagyobb értéket alkalmazza.</p>
              </div>
              <TagCatalogPicker orgId={orgId!} selected={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
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
                  min_lead_time_minutes: s.min_lead_time_minutes ?? 0,
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
