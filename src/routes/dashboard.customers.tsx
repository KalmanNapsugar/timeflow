import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/customers")({
  component: CustomersPage,
});

type Form = {
  id?: string;
  full_name: string;
  email: string;
  phone: string;
  notes_private: string;
  tags: string;
  blacklisted: boolean;
  requires_deposit_override: boolean;
};
const empty: Form = {
  full_name: "", email: "", phone: "", notes_private: "", tags: "",
  blacklisted: false, requires_deposit_override: false,
};

function CustomersPage() {
  const { ownedOrgIds, readOnly } = useAuth();
  const orgId = ownedOrgIds[0];

  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);

  const { data: customers } = useQuery({
    queryKey: ["customers", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (f: Form) => {
      const tags = f.tags.split(",").map(t => t.trim()).filter(Boolean);
      const payload = {
        full_name: f.full_name.trim(),
        email: f.email.trim() || null,
        phone: f.phone.trim() || null,
        notes_private: f.notes_private.trim() || null,
        tags,
        blacklisted: f.blacklisted,
        requires_deposit_override: f.requires_deposit_override,
      };
      if (f.id) {
        const { error } = await supabase.from("customers").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("customers").insert({ ...payload, organization_id: orgId! });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Mentve");
      setOpen(false); setForm(empty);
      qc.invalidateQueries({ queryKey: ["customers", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Törölve"); qc.invalidateQueries({ queryKey: ["customers", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  function openEdit(c: any) {
    setForm({
      id: c.id,
      full_name: c.full_name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      notes_private: c.notes_private ?? "",
      tags: (c.tags ?? []).join(", "),
      blacklisted: !!c.blacklisted,
      requires_deposit_override: !!c.requires_deposit_override,
    });
    setOpen(true);
  }

  if (!orgId) return <p className="text-muted-foreground">Először rendelj magadhoz egy szervezetet.</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Ügyfelek</h1>
        {!readOnly && (
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(empty); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Új ügyfél</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{form.id ? "Ügyfél szerkesztése" : "Új ügyfél"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Teljes név *</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                <div><Label>Telefon</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
              </div>
              <div><Label>Címkék (vesszővel)</Label><Input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="vip, törzsvendég" /></div>
              <div><Label>Belső megjegyzés</Label><Textarea value={form.notes_private} onChange={e => setForm({ ...form, notes_private: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.blacklisted} onChange={e => setForm({ ...form, blacklisted: e.target.checked })} /> Tiltva (feketelistára)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requires_deposit_override} onChange={e => setForm({ ...form, requires_deposit_override: e.target.checked })} /> Mindig előleget kérjen</label>
            </div>
            <DialogFooter>
              <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.full_name.trim()} className="w-full">Mentés</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        )}
      </div>


      <div className="space-y-2">
        {customers?.map((c: any) => (
          <Card key={c.id} className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium flex items-center gap-2 flex-wrap">
                {c.full_name}
                {c.auth_user_id && <Badge variant="outline" className="text-xs">Regisztrált</Badge>}
                {c.blacklisted && <Badge variant="destructive">Tiltva</Badge>}
                {c.requires_deposit_override && <Badge variant="secondary">Előleg kötelező</Badge>}
                {(c.tags ?? []).map((t: string) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
              </div>
              <div className="text-sm text-muted-foreground">{c.email ?? "—"} · {c.phone ?? "—"}</div>
              {c.notes_private && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">📝 {c.notes_private}</div>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs text-muted-foreground mr-2 hidden md:inline">{new Date(c.created_at).toLocaleDateString("hu-HU")}</span>
              {!readOnly && <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="w-4 h-4" /></Button>}
              {!readOnly && <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Törlöd: ${c.full_name}?`)) del.mutate(c.id); }}><Trash2 className="w-4 h-4" /></Button>}
            </div>

          </Card>
        ))}
        {(customers?.length ?? 0) === 0 && <p className="text-muted-foreground">Még nincsenek ügyfelek.</p>}
      </div>
    </div>
  );
}
