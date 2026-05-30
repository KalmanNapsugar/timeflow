import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  if (!orgId) return <p className="text-muted-foreground">Először hozz létre egy üzletet.</p>;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">Beállítások</h1>
      <p className="text-muted-foreground text-sm mb-6">Lemondási szabályok és értesítés sablonok.</p>
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">Általános</TabsTrigger>
          <TabsTrigger value="policies">Lemondási szabályok</TabsTrigger>
          <TabsTrigger value="templates">Értesítés sablonok</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="mt-4"><General orgId={orgId} /></TabsContent>
        <TabsContent value="policies" className="mt-4"><Policies orgId={orgId} /></TabsContent>
        <TabsContent value="templates" className="mt-4"><Templates orgId={orgId} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ===== GENERAL (timezone, DST, booking tz mode) =====
const COMMON_TZ = [
  "Europe/Budapest","Europe/Vienna","Europe/Berlin","Europe/Bucharest","Europe/Warsaw",
  "Europe/London","Europe/Madrid","Europe/Rome","Europe/Paris","Europe/Helsinki",
  "Europe/Istanbul","UTC","America/New_York","America/Los_Angeles","Asia/Dubai","Asia/Tokyo",
];

function General({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const { data: org } = useQuery({
    queryKey: ["org-general", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("organizations")
        .select("timezone, dst_enabled, booking_timezone_mode").eq("id", orgId).single();
      return data;
    },
  });
  const [tz, setTz] = useState("Europe/Budapest");
  const [dst, setDst] = useState(true);
  const [mode, setMode] = useState<"business" | "user">("business");
  useEffect(() => {
    if (!org) return;
    setTz(org.timezone || "Europe/Budapest");
    setDst(org.dst_enabled !== false);
    setMode((org.booking_timezone_mode as any) || "business");
  }, [org]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("organizations")
        .update({ timezone: tz, dst_enabled: dst, booking_timezone_mode: mode })
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mentve"); qc.invalidateQueries({ queryKey: ["org-general", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className="p-4 space-y-4 max-w-xl">
      <div>
        <Label className="text-xs">Üzlet időzónája (foglaláshoz használt)</Label>
        <Select value={tz} onValueChange={setTz}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {COMMON_TZ.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={dst} onChange={e => setDst(e.target.checked)} />
        Nyári/téli időszámítás követése (alapértelmezetten bekapcsolva)
      </label>
      <div className="space-y-2">
        <Label className="text-xs">Foglalási időpontok megjelenítése</Label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="bktz" checked={mode === "business"} onChange={() => setMode("business")} />
          Az üzlet beállított időzónája szerint
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="bktz" checked={mode === "user"} onChange={() => setMode("user")} />
          A foglaló felhasználó helyi ideje szerint
        </label>
      </div>
      <Button size="sm" onClick={() => save.mutate()}><Save className="w-3 h-3 mr-1" /> Mentés</Button>
    </Card>
  );
}

// ===== POLICIES (per service) =====
function Policies({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const { data: services } = useQuery({
    queryKey: ["services-policies", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("services").select("id, name, cancellation_policy_json").eq("organization_id", orgId).order("name");
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async ({ id, policy }: { id: string; policy: any }) => {
      const { error } = await supabase.from("services").update({ cancellation_policy_json: policy }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mentve"); qc.invalidateQueries({ queryKey: ["services-policies", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      {services?.map((s: any) => <PolicyRow key={s.id} service={s} onSave={(p) => save.mutate({ id: s.id, policy: p })} />)}
      {(services?.length ?? 0) === 0 && <p className="text-muted-foreground">Először adj hozzá szolgáltatást.</p>}
    </div>
  );
}

function PolicyRow({ service, onSave }: { service: any; onSave: (p: any) => void }) {
  const [p, setP] = useState(service.cancellation_policy_json ?? { free_until_hours: 24, no_show_fee: 0, late_fee: 0, deposit_non_refundable: false });
  return (
    <Card className="p-4">
      <div className="font-medium mb-3">{service.name}</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <Label className="text-xs">Ingyenes lemondás (óra)</Label>
          <Input type="number" value={p.free_until_hours} onChange={e => setP({ ...p, free_until_hours: +e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">No-show díj (Ft)</Label>
          <Input type="number" value={p.no_show_fee} onChange={e => setP({ ...p, no_show_fee: +e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Késői lemondási díj (Ft)</Label>
          <Input type="number" value={p.late_fee} onChange={e => setP({ ...p, late_fee: +e.target.value })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm mb-3">
        <input type="checkbox" checked={p.deposit_non_refundable} onChange={e => setP({ ...p, deposit_non_refundable: e.target.checked })} />
        Foglaló nem visszatérítendő
      </label>
      <Button size="sm" onClick={() => onSave(p)}><Save className="w-3 h-3 mr-1" /> Mentés</Button>
    </Card>
  );
}

// ===== NOTIFICATION TEMPLATES =====
const TEMPLATE_KEYS = [
  { key: "booking_confirmed", label: "Foglalás megerősítve" },
  { key: "booking_reminder", label: "Emlékeztető" },
  { key: "booking_cancelled", label: "Foglalás lemondva" },
  { key: "booking_rescheduled", label: "Foglalás áthelyezve" },
];

function Templates({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const { data: items } = useQuery({
    queryKey: ["templates", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("notification_templates").select("*").eq("organization_id", orgId);
      return data ?? [];
    },
  });

  const upsert = useMutation({
    mutationFn: async (t: any) => {
      const { error } = await supabase.from("notification_templates").upsert({
        organization_id: orgId, template_key: t.template_key, channel: t.channel,
        subject: t.subject, body: t.body, active: true,
      }, { onConflict: "organization_id,template_key,channel" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mentve"); qc.invalidateQueries({ queryKey: ["templates", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      {TEMPLATE_KEYS.map(tk => {
        const existing = items?.find((i: any) => i.template_key === tk.key);
        return <TemplateRow key={tk.key} label={tk.label} templateKey={tk.key} initial={existing} onSave={(t) => upsert.mutate(t)} />;
      })}
    </div>
  );
}

function TemplateRow({ label, templateKey, initial, onSave }: { label: string; templateKey: string; initial?: any; onSave: (t: any) => void }) {
  const [channel, setChannel] = useState(initial?.channel ?? "email");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");

  useEffect(() => {
    if (initial) { setChannel(initial.channel); setSubject(initial.subject ?? ""); setBody(initial.body ?? ""); }
  }, [initial]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium">{label}</div>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="email">E-mail</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {channel === "email" && (
        <div className="mb-2">
          <Label className="text-xs">Tárgy</Label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} />
        </div>
      )}
      <div className="mb-3">
        <Label className="text-xs">Üzenet (használható: {"{{name}}, {{date}}, {{service}}"})</Label>
        <Textarea value={body} onChange={e => setBody(e.target.value)} rows={4} />
      </div>
      <Button size="sm" onClick={() => onSave({ template_key: templateKey, channel, subject, body })}>
        <Save className="w-3 h-3 mr-1" /> Mentés
      </Button>
    </Card>
  );
}
