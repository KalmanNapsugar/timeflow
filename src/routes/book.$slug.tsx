import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { createBooking, createGuestBooking } from "@/lib/bookings.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/book/$slug")({
  validateSearch: (s: Record<string, unknown>) => ({ service: (s.service as string) || "" }),
  head: () => ({ meta: [{ title: "Foglalás – IdőpontFlow" }] }),
  component: BookingFlow,
});

function BookingFlow() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useAuth();
  const createFn = useServerFn(createBooking);
  const createGuestFn = useServerFn(createGuestBooking);

  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState<string>(search.service || "");
  const [staffId, setStaffId] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<string>("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [hp, setHp] = useState(""); // honeypot
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data } = useQuery({
    queryKey: ["book-provider", slug],
    queryFn: async () => {
      const { data: org } = await supabase.from("organizations").select("*").eq("slug", slug).single();
      if (!org) throw new Error("not found");
      const [{ data: services }, { data: staff }, { data: staffSvc }] = await Promise.all([
        supabase.from("services").select("*").eq("organization_id", org.id).eq("active", true),
        supabase.from("staff_profiles").select("*").eq("organization_id", org.id).eq("active", true),
        supabase.from("staff_services").select("staff_profile_id, service_id"),
      ]);
      return { org, services: services ?? [], staff: staff ?? [], staffSvc: staffSvc ?? [] };
    },
  });

  const service = data?.services.find(s => s.id === serviceId);
  const eligibleStaff = useMemo(() => {
    if (!data || !serviceId) return [];
    const ids = new Set(data.staffSvc.filter(x => x.service_id === serviceId).map(x => x.staff_profile_id));
    return data.staff.filter(s => ids.has(s.id));
  }, [data, serviceId]);

  // Generate simple time slots for next 7 days
  const slots = useMemo(() => {
    const out: { iso: string; label: string }[] = [];
    const now = new Date();
    for (let d = 1; d <= 7; d++) {
      for (const h of [9, 10, 11, 13, 14, 15, 16]) {
        const dt = new Date(now);
        dt.setDate(dt.getDate() + d);
        dt.setHours(h, 0, 0, 0);
        out.push({ iso: dt.toISOString(), label: dt.toLocaleString("hu-HU", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) });
      }
    }
    return out;
  }, []);

  async function handleSubmit() {
    if (!data || !service) return;
    setSubmitting(true);
    try {
      const payload = {
        organizationId: data.org.id,
        serviceId: service.id,
        staffProfileId: staffId,
        startAt,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        policyAccepted: true as const,
        mockDepositPaid: service.deposit_required,
      };
      const res = user
        ? await createFn({ data: payload })
        : await createGuestFn({ data: { ...payload, hp } });
      navigate({ to: "/book/confirmed/$bookingId", params: { bookingId: res.bookingId } });
    } catch (e: any) {
      toast.error(e.message || "Foglalás sikertelen");
    } finally { setSubmitting(false); }
  }

  if (!data) return <div className="container mx-auto p-10">Betöltés…</div>;

  return (
    <div className="min-h-screen container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-6 flex items-center gap-2">
        {[1,2,3,4,5,6].map(n => (
          <div key={n} className={`h-2 flex-1 rounded ${n <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>

      <Card className="p-6 shadow-soft">
        {step === 1 && (
          <>
            <h2 className="text-xl font-semibold mb-4">1. Válassz szolgáltatást</h2>
            <div className="space-y-2">
              {data.services.map(s => (
                <button key={s.id} onClick={() => { setServiceId(s.id); setStep(2); }}
                  className={`w-full text-left p-3 rounded-lg border hover:border-primary transition ${serviceId === s.id ? "border-primary bg-secondary" : ""}`}>
                  <div className="flex justify-between">
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-sm text-muted-foreground">{s.duration_minutes} perc</div>
                    </div>
                    <div className="font-semibold">{Number(s.price).toLocaleString("hu-HU")} Ft</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-xl font-semibold mb-4">2. Munkatárs</h2>
            <button onClick={() => { setStaffId(null); setStep(3); }} className="w-full p-3 rounded-lg border hover:border-primary text-left mb-2">
              Bármely szabad kolléga
            </button>
            {eligibleStaff.map(s => (
              <button key={s.id} onClick={() => { setStaffId(s.id); setStep(3); }}
                className="w-full p-3 rounded-lg border hover:border-primary text-left mb-2 flex items-center gap-3">
                {s.avatar_url && <img src={s.avatar_url} className="w-10 h-10 rounded-full" />}
                <span>{s.display_name}</span>
              </button>
            ))}
            <Button variant="outline" onClick={() => setStep(1)}>Vissza</Button>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-xl font-semibold mb-4">3. Időpont</h2>
            <div className="grid grid-cols-2 gap-2 mb-4 max-h-96 overflow-y-auto">
              {slots.map(sl => (
                <button key={sl.iso} onClick={() => { setStartAt(sl.iso); setStep(4); }}
                  className={`p-2 text-sm rounded border hover:border-primary ${startAt === sl.iso ? "border-primary bg-secondary" : ""}`}>
                  {sl.label}
                </button>
              ))}
            </div>
            <Button variant="outline" onClick={() => setStep(2)}>Vissza</Button>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-xl font-semibold mb-4">4. Adataid</h2>
            {!user && (
              <p className="text-sm text-muted-foreground mb-3">
                Vendégként foglalsz. Ha van fiókod, <button type="button" onClick={() => navigate({ to: "/login" })} className="underline">jelentkezz be</button> a foglalásaid kezeléséhez.
              </p>
            )}
            <div className="space-y-3">
              <div><Label>Név</Label><Input value={name} onChange={e => setName(e.target.value)} maxLength={120} /></div>
              <div><Label>E-mail</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={200} /></div>
              <div><Label>Telefon</Label><Input value={phone} onChange={e => setPhone(e.target.value)} maxLength={30} /></div>
              {/* Honeypot — hidden from real users */}
              <input type="text" name="company" value={hp} onChange={e => setHp(e.target.value)} autoComplete="off" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setStep(3)}>Vissza</Button>
              <Button onClick={() => setStep(5)} disabled={!name || !email || !phone}>Tovább</Button>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="text-xl font-semibold mb-4">5. Lemondási feltételek</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Ingyenes lemondás 24 órával az időpont előtt. Késői lemondás vagy meg nem jelenés esetén az előleg nem visszatérítendő.
            </p>
            <label className="flex items-center gap-2 mb-4">
              <Checkbox checked={accepted} onCheckedChange={(c) => setAccepted(c === true)} />
              <span className="text-sm">Elfogadom a feltételeket és adatkezelési tájékoztatót</span>
            </label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(4)}>Vissza</Button>
              <Button onClick={() => setStep(6)} disabled={!accepted}>Tovább</Button>
            </div>
          </>
        )}

        {step === 6 && service && (
          <>
            <h2 className="text-xl font-semibold mb-4">6. Összegzés és fizetés</h2>
            <div className="space-y-2 mb-4 text-sm">
              <div><strong>Szolgáltatás:</strong> {service.name}</div>
              <div><strong>Időpont:</strong> {new Date(startAt).toLocaleString("hu-HU")}</div>
              <div><strong>Ár:</strong> {Number(service.price).toLocaleString("hu-HU")} Ft</div>
              {service.deposit_required && (
                <Badge variant="secondary">Mock előleg: {Number(service.deposit_amount).toLocaleString("hu-HU")} Ft</Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(5)}>Vissza</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Foglalás…" : "Foglalás megerősítése"}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
