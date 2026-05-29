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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Ticket, Gift, Package } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/marketing")({
  component: MarketingPage,
});

function MarketingPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  if (!orgId) return <p className="text-muted-foreground">Először hozz létre egy üzletet.</p>;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">Marketing</h1>
      <p className="text-muted-foreground text-sm mb-6">Kuponok, ajándékkártyák és szolgáltatás csomagok.</p>
      <Tabs defaultValue="coupons">
        <TabsList>
          <TabsTrigger value="coupons"><Ticket className="w-4 h-4 mr-2" />Kuponok</TabsTrigger>
          <TabsTrigger value="vouchers"><Gift className="w-4 h-4 mr-2" />Ajándékkártyák</TabsTrigger>
          <TabsTrigger value="packages"><Package className="w-4 h-4 mr-2" />Csomagok</TabsTrigger>
        </TabsList>
        <TabsContent value="coupons" className="mt-4"><Coupons orgId={orgId} /></TabsContent>
        <TabsContent value="vouchers" className="mt-4"><Vouchers orgId={orgId} /></TabsContent>
        <TabsContent value="packages" className="mt-4"><Packages orgId={orgId} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ===== COUPONS =====
function Coupons({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", type: "percent", value: 10, max_uses: 100, active: true });

  const { data: items } = useQuery({
    queryKey: ["coupons", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("coupons").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("coupons").insert({ organization_id: orgId, ...form, code: form.code.toUpperCase() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Kupon létrehozva"); setOpen(false); qc.invalidateQueries({ queryKey: ["coupons", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("coupons").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons", orgId] }),
  });

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-1" />Új kupon</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Új kupon</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Kód</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="NYAR20" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Típus</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Százalék (%)</SelectItem>
                      <SelectItem value="fixed">Fix összeg (Ft)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Érték</Label><Input type="number" value={form.value} onChange={e => setForm({ ...form, value: +e.target.value })} /></div>
              </div>
              <div><Label>Max felhasználás</Label><Input type="number" value={form.max_uses} onChange={e => setForm({ ...form, max_uses: +e.target.value })} /></div>
              <Button onClick={() => save.mutate()} disabled={!form.code || save.isPending} className="w-full">Mentés</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {items?.map((c: any) => (
          <Card key={c.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-mono font-bold">{c.code}</div>
              <div className="text-sm text-muted-foreground">
                {c.type === "percent" ? `${c.value}%` : `${Number(c.value).toLocaleString("hu-HU")} Ft`} kedvezmény ·
                Használva: {c.used_count}/{c.max_uses ?? "∞"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {c.active ? <Badge variant="secondary">aktív</Badge> : <Badge variant="outline">inaktív</Badge>}
              <Button variant="ghost" size="icon" onClick={() => { if (confirm("Törlöd?")) del.mutate(c.id); }}><Trash2 className="w-4 h-4" /></Button>
            </div>
          </Card>
        ))}
        {(items?.length ?? 0) === 0 && <p className="text-muted-foreground">Még nincs kupon.</p>}
      </div>
    </div>
  );
}

// ===== VOUCHERS =====
function Vouchers({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", initial_amount: 10000, recipient_email: "" });

  const { data: items } = useQuery({
    queryKey: ["vouchers", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("vouchers").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const code = form.code || `GIFT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const { error } = await supabase.from("vouchers").insert({
        organization_id: orgId, code, initial_amount: form.initial_amount, balance: form.initial_amount,
        recipient_email: form.recipient_email || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Ajándékkártya létrehozva"); setOpen(false); qc.invalidateQueries({ queryKey: ["vouchers", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-1" />Új ajándékkártya</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Új ajándékkártya</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Kód (üres = automatikus)</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
              <div><Label>Összeg (Ft)</Label><Input type="number" value={form.initial_amount} onChange={e => setForm({ ...form, initial_amount: +e.target.value })} /></div>
              <div><Label>Címzett e-mail (opcionális)</Label><Input type="email" value={form.recipient_email} onChange={e => setForm({ ...form, recipient_email: e.target.value })} /></div>
              <Button onClick={() => save.mutate()} disabled={save.isPending || form.initial_amount <= 0} className="w-full">Kibocsátás</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {items?.map((v: any) => (
          <Card key={v.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-mono font-bold">{v.code}</div>
              <div className="text-sm text-muted-foreground">
                Egyenleg: <strong>{Number(v.balance).toLocaleString("hu-HU")} Ft</strong> / {Number(v.initial_amount).toLocaleString("hu-HU")} Ft
                {v.recipient_email && ` · ${v.recipient_email}`}
              </div>
            </div>
            {v.active ? <Badge variant="secondary">aktív</Badge> : <Badge variant="outline">felhasználva</Badge>}
          </Card>
        ))}
        {(items?.length ?? 0) === 0 && <p className="text-muted-foreground">Még nincs ajándékkártya.</p>}
      </div>
    </div>
  );
}

// ===== PACKAGES =====
function Packages({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", price: 0, validity_months: 12 });

  const { data: items } = useQuery({
    queryKey: ["packages", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("service_packages").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("service_packages").insert({ organization_id: orgId, ...form });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Csomag létrehozva"); setOpen(false); qc.invalidateQueries({ queryKey: ["packages", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("service_packages").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["packages", orgId] }),
  });

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-1" />Új csomag</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Új szolgáltatás csomag</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Név</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Leírás</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Ár (Ft)</Label><Input type="number" value={form.price} onChange={e => setForm({ ...form, price: +e.target.value })} /></div>
                <div><Label>Érvényesség (hónap)</Label><Input type="number" value={form.validity_months} onChange={e => setForm({ ...form, validity_months: +e.target.value })} /></div>
              </div>
              <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name} className="w-full">Mentés</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {items?.map((p: any) => (
          <Card key={p.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{p.name}</div>
              <div className="text-sm text-muted-foreground">
                {Number(p.price).toLocaleString("hu-HU")} Ft · {p.validity_months} hónapig érvényes
              </div>
              {p.description && <div className="text-xs text-muted-foreground mt-1">{p.description}</div>}
            </div>
            <Button variant="ghost" size="icon" onClick={() => { if (confirm("Törlöd?")) del.mutate(p.id); }}><Trash2 className="w-4 h-4" /></Button>
          </Card>
        ))}
        {(items?.length ?? 0) === 0 && <p className="text-muted-foreground">Még nincs csomag.</p>}
      </div>
    </div>
  );
}
