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

function ResourceGroupsEditor({ orgId, serviceId }: { orgId: string; serviceId: string | undefined }) {
  const qc = useQueryClient();
  const { data: resources } = useQuery({
    queryKey: ["resources", orgId],
    queryFn: async () => (await supabase.from("resources").select("id, name, type").eq("organization_id", orgId).eq("active", true).order("name")).data ?? [],
  });
  const { data: rows } = useQuery({
    queryKey: ["service_resources", serviceId],
    enabled: !!serviceId,
    queryFn: async () => (await supabase.from("service_resources").select("id, resource_id, group_no").eq("service_id", serviceId!)).data ?? [],
  });

  const groups = useMemo(() => {
    const m = new Map<number, { id: string; resource_id: string }[]>();
    (rows ?? []).forEach((r: any) => {
      if (!m.has(r.group_no)) m.set(r.group_no, []);
      m.get(r.group_no)!.push({ id: r.id, resource_id: r.resource_id });
    });
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [rows]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["service_resources", serviceId] });
    qc.invalidateQueries({ queryKey: ["all_service_resources", orgId] });
  };

  const addResource = useMutation({
    mutationFn: async ({ groupNo, resourceId }: { groupNo: number; resourceId: string }) => {
      const { error } = await supabase.from("service_resources").insert({ service_id: serviceId!, resource_id: resourceId, group_no: groupNo, required: true });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.message),
  });

  const removeRow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("service_resources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.message),
  });

  if (!serviceId) {
    return <p className="text-xs text-muted-foreground">Először mentsd el a szolgáltatást, utána tudsz erőforrást rendelni hozzá.</p>;
  }

  const nextGroupNo = (groups.length === 0 ? 1 : Math.max(...groups.map(([g]) => g)) + 1);

  return (
    <div className="space-y-2">
      <Label>Szükséges erőforrások</Label>
      <p className="text-xs text-muted-foreground">Egy csoporton belül VAGY (bármelyik megfelel); a csoportok közt ÉS. Pl. (Szoba1 VAGY Szoba2) ÉS Eszköz.</p>
      <div className="space-y-2">
        {groups.map(([groupNo, items], idx) => (
          <div key={groupNo} className="border rounded-md p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">{idx + 1}. csoport (VAGY)</span>
              {idx > 0 && <span className="text-xs text-muted-foreground">ÉS</span>}
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {items.map((it) => {
                const r = (resources ?? []).find((x: any) => x.id === it.resource_id);
                return (
                  <Badge key={it.id} variant="secondary" className="gap-1">
                    {r?.name ?? "?"}
                    <button type="button" onClick={() => removeRow.mutate(it.id)} className="ml-1 hover:text-destructive"><X className="w-3 h-3" /></button>
                  </Badge>
                );
              })}
              {items.length === 0 && <span className="text-xs text-muted-foreground">Üres — adj hozzá legalább egyet.</span>}
            </div>
            <select
              className="text-sm border rounded px-2 py-1 w-full"
              value=""
              onChange={(e) => {
                if (e.target.value) addResource.mutate({ groupNo, resourceId: e.target.value });
                e.currentTarget.value = "";
              }}
            >
              <option value="">+ Erőforrás hozzáadása…</option>
              {(resources ?? []).filter((r: any) => !items.some((it) => it.resource_id === r.id)).map((r: any) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => {
        // Üres csoport megjelenítéséhez ne csináljunk semmit DB-ben; a következő erőforrás-hozzáadás létrehozza.
        // De adjunk vizuális csoportot is: insert egy első erőforrást
        const first = (resources ?? []).find((r: any) => !groups.some(([, items]) => items.some((it) => it.resource_id === r.id)))
          ?? (resources ?? [])[0];
        if (!first) { toast.error("Nincs felvehető erőforrás"); return; }
        addResource.mutate({ groupNo: nextGroupNo, resourceId: first.id });
      }} disabled={(resources ?? []).length === 0}>
        <Plus className="w-3 h-3 mr-1" />Új ÉS-csoport
      </Button>
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

  const { data: catalogTags } = useQuery({
    queryKey: ["service_tags", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("service_tags").select("*").eq("organization_id", orgId).order("name");
      return data ?? [];
    },
  });

  const { data: orgResources } = useQuery({
    queryKey: ["resources", orgId],
    enabled: !!orgId,
    queryFn: async () => (await supabase.from("resources").select("id, name").eq("organization_id", orgId).eq("active", true)).data ?? [],
  });
  const { data: allServiceResources } = useQuery({
    queryKey: ["all_service_resources", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const svcIds = (await supabase.from("services").select("id").eq("organization_id", orgId)).data?.map((s: any) => s.id) ?? [];
      if (svcIds.length === 0) return [];
      return (await supabase.from("service_resources").select("service_id, resource_id, group_no").in("service_id", svcIds)).data ?? [];
    },
  });
  const resourceGroupsByService = useMemo(() => {
    const resName = new Map<string, string>();
    (orgResources ?? []).forEach((r: any) => resName.set(r.id, r.name));
    const bySvc = new Map<string, Map<number, string[]>>();
    (allServiceResources ?? []).forEach((r: any) => {
      if (!bySvc.has(r.service_id)) bySvc.set(r.service_id, new Map());
      const m = bySvc.get(r.service_id)!;
      if (!m.has(r.group_no)) m.set(r.group_no, []);
      m.get(r.group_no)!.push(resName.get(r.resource_id) ?? "?");
    });
    const out = new Map<string, string[][]>();
    for (const [svcId, m] of bySvc) {
      out.set(svcId, Array.from(m.entries()).sort((a, b) => a[0] - b[0]).map(([, names]) => names));
    }
    return out;
  }, [allServiceResources, orgResources]);

  const toggleTagOnService = useMutation({
    mutationFn: async ({ service, tag }: { service: any; tag: string }) => {
      const current: string[] = service.tags ?? [];
      const next = current.includes(tag) ? current.filter(x => x !== tag) : [...current, tag];
      const { error } = await supabase.from("services").update({ tags: next }).eq("id", service.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["services", orgId] }),
    onError: (e: any) => toast.error(e.message),
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
              <ResourceGroupsEditor orgId={orgId!} serviceId={form.id} />
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
          <Card key={s.id} className="p-4 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{s.name} {!s.active && <span className="text-xs text-muted-foreground">(inaktív)</span>}</div>
              <div className="text-sm text-muted-foreground">{s.duration_minutes} perc · {Number(s.price).toLocaleString("hu-HU")} Ft</div>
              {(s.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {s.tags.map((t: string) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                </div>
              )}
              {(resourceGroupsByService.get(s.id) ?? []).length > 0 && (
                <div className="text-xs text-muted-foreground mt-1">
                  Erőforrás: {(resourceGroupsByService.get(s.id) ?? []).map((g, i) => (
                    <span key={i}>
                      {i > 0 && <span className="mx-1 font-medium">ÉS</span>}
                      {g.length > 1 ? <>({g.join(" VAGY ")})</> : g[0]}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {(catalogTags ?? []).length > 0 && (
              <div className="hidden md:flex flex-wrap gap-x-3 gap-y-1 max-w-[40%] shrink-0">
                {(catalogTags ?? []).map((t: any) => {
                  const checked = (s.tags ?? []).includes(t.name);
                  return (
                    <label key={t.id} className="flex items-center gap-1 text-xs cursor-pointer">
                      <Checkbox checked={checked} onCheckedChange={() => toggleTagOnService.mutate({ service: s, tag: t.name })} />
                      <span>{t.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
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
