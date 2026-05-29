import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getOrgEmailSettings, updateOrgEmailSettings } from "@/lib/email.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Save, Mail, Globe, Key, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/email-settings")({
  head: () => ({ meta: [{ title: "E-mail beállítások" }] }),
  component: EmailSettingsPage,
});

function EmailSettingsPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  if (!orgId) return <p className="text-muted-foreground">Először hozz létre egy üzletet.</p>;

  const qc = useQueryClient();
  const fetchSettings = useServerFn(getOrgEmailSettings);
  const updateFn = useServerFn(updateOrgEmailSettings);

  const { data, isLoading } = useQuery({
    queryKey: ["email_settings", orgId],
    queryFn: () => fetchSettings({ data: { orgId } }),
  });

  const [form, setForm] = useState({
    sender_name: "",
    sender_email: "" as string | null,
    reply_to: "" as string | null,
    provider: "lovable_shared" as "lovable_shared" | "lovable_custom_domain" | "resend",
    custom_domain: "" as string | null,
    resend_api_key: "" as string | null,
  });

  useEffect(() => {
    if (data) {
      setForm({
        sender_name: data.sender_name ?? "",
        sender_email: data.sender_email ?? "",
        reply_to: data.reply_to ?? "",
        provider: (data.provider as any) ?? "lovable_shared",
        custom_domain: data.custom_domain ?? "",
        resend_api_key: data.resend_api_key_secret_name ?? "",
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => updateFn({ data: { orgId, ...form } as any }),
    onSuccess: () => { toast.success("Beállítások mentve"); qc.invalidateQueries({ queryKey: ["email_settings", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <p>Betöltés…</p>;

  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Vágólapra másolva"); };

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold mb-1">Kimenő e-mailek</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Az üzleted nevében küldött visszaigazoló e-mailek beállítása. Más üzletek e-mailjeit nem éred el — minden beállítás csak erre az egy üzletre vonatkozik.
      </p>

      <Tabs defaultValue="sender">
        <TabsList>
          <TabsTrigger value="sender"><Mail className="w-4 h-4 mr-1" /> Feladó</TabsTrigger>
          <TabsTrigger value="domain"><Globe className="w-4 h-4 mr-1" /> Saját domain</TabsTrigger>
          <TabsTrigger value="resend"><Key className="w-4 h-4 mr-1" /> Saját Resend</TabsTrigger>
        </TabsList>

        <TabsContent value="sender" className="mt-4">
          <Card className="p-5 space-y-4">
            <div>
              <Label>Küldési mód</Label>
              <Select value={form.provider} onValueChange={(v: any) => setForm({ ...form, provider: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lovable_shared">Közös platform feladó (alapértelmezett)</SelectItem>
                  <SelectItem value="lovable_custom_domain">Saját domain (Lovable Emails-en keresztül)</SelectItem>
                  <SelectItem value="resend">Saját Resend kulcs</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Ajánlott: <strong>közös feladó</strong> azonnali kezdéshez, később bármikor átállhatsz saját domainre.
              </p>
            </div>
            <div>
              <Label>Feladó név (ahogy a címzett látja)</Label>
              <Input value={form.sender_name} onChange={e => setForm({ ...form, sender_name: e.target.value })}
                placeholder="pl. Anna Szépségszalon" />
            </div>
            <div>
              <Label>Feladó e-mail cím</Label>
              <Input type="email" value={form.sender_email ?? ""} onChange={e => setForm({ ...form, sender_email: e.target.value })}
                placeholder={form.provider === "lovable_shared" ? "Üresen hagyhatod – a közös cím használata" : "foglalas@tedomain.hu"} />
            </div>
            <div>
              <Label>Válasz cím (reply-to)</Label>
              <Input type="email" value={form.reply_to ?? ""} onChange={e => setForm({ ...form, reply_to: e.target.value })}
                placeholder="opcionális" />
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="w-4 h-4 mr-1" /> Mentés
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="domain" className="mt-4 space-y-4">
          <Alert>
            <AlertTitle>Mire jó?</AlertTitle>
            <AlertDescription>
              Saját domainről küldve (pl. <code>foglalas@annaszepsegszalon.hu</code>) a leveleid sokkal magasabb arányban érkeznek be (nem spamre), és az ügyfél azonnal felismer.
            </AlertDescription>
          </Alert>
          <Card className="p-5 space-y-4">
            <div>
              <Label>Subdomain (amit te birtokolsz)</Label>
              <Input value={form.custom_domain ?? ""} onChange={e => setForm({ ...form, custom_domain: e.target.value })}
                placeholder="notify.tedomain.hu" />
              <p className="text-xs text-muted-foreground mt-1">
                Javaslat: használj subdomain-t (pl. <code>notify.</code> vagy <code>mail.</code>), így a fő domain levelezését nem zavarja meg.
              </p>
            </div>

            <div className="border rounded-lg p-4 bg-muted/30 text-sm">
              <div className="font-medium mb-2">Lépések:</div>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Mentsd el a subdomain-t fent.</li>
                <li>Lépj be a domain regisztrátorod (pl. Cloudflare, GoDaddy) DNS adminjába.</li>
                <li>Add hozzá az alábbi NS rekordokat a subdomain-hez:</li>
              </ol>
              <div className="mt-3 space-y-1 font-mono text-xs">
                {["ns3.lovable.cloud", "ns4.lovable.cloud"].map(ns => (
                  <div key={ns} className="flex items-center gap-2 bg-background rounded px-2 py-1">
                    <span className="text-muted-foreground">NS</span>
                    <span className="flex-1">{ns}</span>
                    <Button size="icon" variant="ghost" onClick={() => copy(ns)}><Copy className="w-3 h-3" /></Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                A DNS terjedése 1-72 órát vehet igénybe. Amint elkészül, a leveleid automatikusan a saját domainedről mennek ki.
              </p>
            </div>

            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="w-4 h-4 mr-1" /> Mentés
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="resend" className="mt-4 space-y-4">
          <Alert>
            <AlertTitle>Saját Resend fiók</AlertTitle>
            <AlertDescription>
              Ha már van Resend.com fiókod (vagy szeretnél nyitni), itt adhatod meg az API kulcsodat. Ekkor a levelek a te Resend fiókodból mennek ki — a Resend statisztikák, naplók és számlázás is náluk lesznek.
            </AlertDescription>
          </Alert>
          <Card className="p-5 space-y-4">
            <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
              <li>Nyiss fiókot a <a href="https://resend.com" target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">resend.com <ExternalLink className="w-3 h-3" /></a> oldalon.</li>
              <li>Igazold a domain-edet a Resend felületén (DNS rekordokkal).</li>
              <li>Generálj egy API kulcsot: <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">resend.com/api-keys <ExternalLink className="w-3 h-3" /></a></li>
              <li>Másold be alább.</li>
            </ol>
            <div>
              <Label>Resend API kulcs</Label>
              <Input type="password" value={form.resend_api_key ?? ""} onChange={e => setForm({ ...form, resend_api_key: e.target.value })}
                placeholder="re_..." />
              <p className="text-xs text-muted-foreground mt-1">
                A kulcsot csak a te üzleted éri el. Más üzlet (vagy platform admin) nem látja.
              </p>
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="w-4 h-4 mr-1" /> Mentés
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
