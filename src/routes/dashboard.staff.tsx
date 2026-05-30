import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Pencil, Plus, Trash2, Mail, UserMinus, XCircle, Copy } from "lucide-react";
import { toast } from "sonner";
import { PhoneInput } from "@/components/PhoneInput";
import {
  inviteStaff, listOrgInvitations, listOrgMembers, listStaffProfiles,
  revokeInvitation, removeStaffMember,
} from "@/lib/staff.functions";
import {
  listStaffResourceAssignments, upsertStaffResourceAssignment, deleteStaffResourceAssignment,
  computeStaffResourceEffectiveAvailability,
} from "@/lib/staff-resources.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";



export const Route = createFileRoute("/dashboard/staff")({
  component: StaffPage,
});

type DayKey = "mon"|"tue"|"wed"|"thu"|"fri"|"sat"|"sun";
type WindowEntry = { start: string; end: string };
type ParityMode = "single" | "alternating";
type Form = {
  id?: string;
  full_name: string;
  display_name: string;
  email: string;
  phone: string;
  bio: string;
  active: boolean;
  parityMode: ParityMode;
  weekly: Record<DayKey, string>;
  weeklyEven: Record<DayKey, string>;
  weeklyOdd: Record<DayKey, string>;
  windows: WindowEntry[];
  min_lead_time_minutes: number;
  allow_instant_after_booking: boolean;
};
const emptyWeekly: Record<DayKey,string> = { mon:"09:00-17:00", tue:"09:00-17:00", wed:"09:00-17:00", thu:"09:00-17:00", fri:"09:00-17:00", sat:"", sun:"" };
const emptyDays: Record<DayKey,string> = { mon:"", tue:"", wed:"", thu:"", fri:"", sat:"", sun:"" };
const empty: Form = {
  full_name: "", display_name: "", email: "", phone: "", bio: "", active: true,
  parityMode: "single",
  weekly: { ...emptyWeekly },
  weeklyEven: { ...emptyDays },
  weeklyOdd: { ...emptyDays },
  windows: [], min_lead_time_minutes: 0, allow_instant_after_booking: false,
};

function parseWeeklyDays(weekly: Record<DayKey,string>): any {
  const out: any = {};
  for (const d of ["mon","tue","wed","thu","fri","sat","sun"] as DayKey[]) {
    const v = weekly[d].trim();
    if (!v) { out[d] = null; continue; }
    out[d] = v.split(",").map(s => s.trim().split("-").map(x => x.trim())).filter(p => p.length === 2);
  }
  return out;
}
function buildWorkingHours(form: Form): any {
  if (form.parityMode === "alternating") {
    return {
      mode: "alternating",
      alt: {
        even: parseWeeklyDays(form.weeklyEven),
        odd: parseWeeklyDays(form.weeklyOdd),
      },
    };
  }
  return parseWeeklyDays(form.weekly);
}
function daysToInput(pat: any): Record<DayKey,string> {
  const out: Record<DayKey,string> = { mon:"", tue:"", wed:"", thu:"", fri:"", sat:"", sun:"" };
  if (!pat) return out;
  for (const d of Object.keys(out) as DayKey[]) {
    const v = pat[d];
    if (!v) continue;
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string") out[d] = `${v[0]}-${v[1]}`;
    else if (Array.isArray(v)) out[d] = v.map((p: any[]) => p.join("-")).join(",");
  }
  return out;
}
function parsePatternToForm(pat: any): Pick<Form, "parityMode" | "weekly" | "weeklyEven" | "weeklyOdd"> {
  if (pat && pat.mode === "alternating" && pat.alt) {
    return {
      parityMode: "alternating",
      weekly: { ...emptyDays },
      weeklyEven: daysToInput(pat.alt.even),
      weeklyOdd: daysToInput(pat.alt.odd),
    };
  }
  return {
    parityMode: "single",
    weekly: daysToInput(pat),
    weeklyEven: { ...emptyDays },
    weeklyOdd: { ...emptyDays },
  };
}

function StaffPage() {
  const { ownedOrgIds, readOnly, user } = useAuth();
  const orgId = ownedOrgIds[0];

  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);

  const invite = useServerFn(inviteStaff);
  const fetchInvites = useServerFn(listOrgInvitations);
  const fetchMembers = useServerFn(listOrgMembers);
  const revoke = useServerFn(revokeInvitation);
  const removeMember = useServerFn(removeStaffMember);

  const [inviteEmail, setInviteEmail] = useState("");

  const fetchStaff = useServerFn(listStaffProfiles);
  const { data: staff } = useQuery({
    queryKey: ["staff", orgId],
    enabled: !!orgId,
    queryFn: () => fetchStaff({ data: { organizationId: orgId! } }),
  });

  const { data: members } = useQuery({
    queryKey: ["org-members", orgId],
    enabled: !!orgId,
    queryFn: () => fetchMembers({ data: { organizationId: orgId! } }),
  });

  const { data: invitations } = useQuery({
    queryKey: ["org-invitations", orgId],
    enabled: !!orgId,
    queryFn: () => fetchInvites({ data: { organizationId: orgId! } }),
  });

  const save = useMutation({
    mutationFn: async (f: Form) => {
      const working_hours_json = buildWorkingHours(f);
      const availability_windows_json = f.windows.filter(w => w.start && w.end).map(w => ({
        start: new Date(w.start).toISOString(),
        end: new Date(w.end).toISOString(),
      }));
      const payload = {
        full_name: f.full_name.trim() || null,
        display_name: f.display_name,
        email: f.email.trim(),
        phone: f.phone.trim() || null,
        bio: f.bio,
        active: f.active,
        working_hours_json,
        availability_windows_json,
        min_lead_time_minutes: f.min_lead_time_minutes,
        allow_instant_after_booking: f.allow_instant_after_booking,
      };
      if (f.id) {
        const { error } = await supabase.from("staff_profiles").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("staff_profiles").insert({ organization_id: orgId!, ...payload });
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

  const sendInvite = useMutation({
    mutationFn: () => invite({ data: { organizationId: orgId!, email: inviteEmail } }),
    onSuccess: () => {
      toast.success("Meghívás elküldve");
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["org-invitations", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const revokeM = useMutation({
    mutationFn: (id: string) => revoke({ data: { invitationId: id } }),
    onSuccess: () => { toast.success("Visszavonva"); qc.invalidateQueries({ queryKey: ["org-invitations", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const removeM = useMutation({
    mutationFn: (id: string) => removeMember({ data: { memberId: id } }),
    onSuccess: () => { toast.success("Eltávolítva"); qc.invalidateQueries({ queryKey: ["org-members", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const ownerSelfProfile = (staff ?? []).find((s: any) => s.user_id === user?.id);
  const createOwnerProfile = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("staff_profiles").insert({
        organization_id: orgId!, display_name: "Tulajdonos (Te)", user_id: user!.id, active: true,
        email: user?.email ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Tulajdonosi munkatárs-profil létrehozva"); qc.invalidateQueries({ queryKey: ["staff", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!orgId) return <p className="text-muted-foreground">Először rendelj magadhoz egy szervezetet.</p>;

  return (
    <div className="space-y-8">
      {/* Csapat (org_members) */}
      <section>
        <h1 className="text-3xl font-bold mb-4">Csapat</h1>
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Aktív tagok</h2>
          {(members?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">Még nincs csapattag (rajtad kívül).</p>}
          <div className="space-y-2">
            {members?.map(m => (
              <div key={m.id} className="flex items-center justify-between border rounded-md p-3">
                <div>
                  <div className="text-sm font-medium">{m.email}</div>
                  <div className="text-xs text-muted-foreground"><Badge variant="outline">{m.role}</Badge> {!m.active && <span className="ml-2">inaktív</span>}</div>
                </div>
                {!readOnly && m.role !== "owner" && (
                  <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Eltávolítod: ${m.email}?`)) removeM.mutate(m.id); }}>
                    <UserMinus className="w-4 h-4 mr-1" /> Eltávolítás
                  </Button>
                )}

              </div>
            ))}
          </div>
        </Card>

        {!readOnly && (
        <Card className="p-4 mt-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Mail className="w-4 h-4" /> Meghívás</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Add meg egy <strong>már regisztrált felhasználó</strong> e-mail címét. A meghívást ő a saját profil oldalán fogadhatja el.
          </p>
          <div className="flex gap-2 max-w-md">
            <Input type="email" placeholder="email@példa.hu" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
            <Button onClick={() => sendInvite.mutate()} disabled={!inviteEmail || sendInvite.isPending}>Meghívás küldése</Button>
          </div>

          {(invitations?.length ?? 0) > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-sm font-medium">Meghívások előzménye</div>
              {invitations?.map(i => (
                <div key={i.id} className="flex items-center justify-between text-sm border rounded-md p-2">
                  <div>
                    <span className="font-medium">{i.invited_email}</span>
                    <Badge variant="outline" className="ml-2">{i.status}</Badge>
                    <span className="text-xs text-muted-foreground ml-2">{new Date(i.created_at).toLocaleString("hu-HU")}</span>
                  </div>
                  {i.status === "pending" && (
                    <Button variant="ghost" size="sm" onClick={() => revokeM.mutate(i.id)}>
                      <XCircle className="w-4 h-4 mr-1" /> Visszavon
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
        )}

      </section>

      {/* Munkatárs profilok (foglaláshoz kötött szakember kártyák) */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Munkatárs profilok</h2>
          <div className="flex items-center gap-2">
          {!readOnly && !ownerSelfProfile && user && (
            <Button variant="outline" size="sm" onClick={() => createOwnerProfile.mutate()} disabled={createOwnerProfile.isPending}>
              Saját tulajdonosi profil létrehozása
            </Button>
          )}
          {!readOnly && (
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(empty); }}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Új</Button></DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{form.id ? "Szerkesztés" : "Új munkatárs profil"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Teljes név <span className="text-xs text-muted-foreground">(csak belső)</span></Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="pl. Kovács Anna" /></div>
                <div><Label>Megjelenő név <span className="text-xs text-muted-foreground">(foglalásoknál látszik)</span></Label><Input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} placeholder="pl. Anna" /></div>
                <div><Label>E-mail <span className="text-destructive">*</span></Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@példa.hu" /></div>
                <div><Label>Telefonszám <span className="text-xs text-muted-foreground">(opcionális)</span></Label><PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></div>
                <div><Label>Bemutatkozás</Label><Textarea value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Aktív</label>

                <div className="border-t pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-base font-semibold">Heti munkaidő</Label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={form.parityMode === "alternating"}
                        onChange={(e) => setForm({ ...form, parityMode: e.target.checked ? "alternating" : "single" })}
                      />
                      Váltott műszak (páros/páratlan hét)
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">Formátum naponként: <code>09:00-13:00,14:00-17:00</code> (üres = nincs aznap rendelés)</p>
                  {form.parityMode === "single" && (
                    <div>
                      {(["mon","tue","wed","thu","fri","sat","sun"] as DayKey[]).map((d) => (
                        <div key={d} className="grid grid-cols-[60px_1fr] items-center gap-2 mb-1">
                          <Label className="text-xs uppercase">{d}</Label>
                          <Input value={form.weekly[d]} onChange={(e) => setForm({ ...form, weekly: { ...form.weekly, [d]: e.target.value } })} placeholder="pl. 09:00-13:00,14:00-17:00" />
                        </div>
                      ))}
                    </div>
                  )}
                  {form.parityMode === "alternating" && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">A rendszer az ISO hét sorszáma alapján váltogat. Példa: 2026 közepén a páros hetek (pl. 22., 24., …), páratlan hetek (pl. 21., 23., …) az ellenkező mintát kapják.</p>
                      <div>
                        <div className="text-sm font-semibold mb-1">Páros hét</div>
                        {(["mon","tue","wed","thu","fri","sat","sun"] as DayKey[]).map((d) => (
                          <div key={d} className="grid grid-cols-[60px_1fr] items-center gap-2 mb-1">
                            <Label className="text-xs uppercase">{d}</Label>
                            <Input value={form.weeklyEven[d]} onChange={(e) => setForm({ ...form, weeklyEven: { ...form.weeklyEven, [d]: e.target.value } })} placeholder="pl. 09:00-17:00" />
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className="text-sm font-semibold mb-1">Páratlan hét</div>
                        {(["mon","tue","wed","thu","fri","sat","sun"] as DayKey[]).map((d) => (
                          <div key={d} className="grid grid-cols-[60px_1fr] items-center gap-2 mb-1">
                            <Label className="text-xs uppercase">{d}</Label>
                            <Input value={form.weeklyOdd[d]} onChange={(e) => setForm({ ...form, weeklyOdd: { ...form.weeklyOdd, [d]: e.target.value } })} placeholder="pl. 12:00-20:00" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <Label className="text-base font-semibold">Rendelkezésre állási időablakok</Label>
                      <p className="text-xs text-muted-foreground">Ha üres → csak a heti minta számít. Ha van legalább egy ablak → CSAK ezeken belül foglalható (pl. szabadság, projekt időszak).</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, windows: [...form.windows, { start: "", end: "" }] })}>
                      <Plus className="w-3 h-3 mr-1" />Új
                    </Button>
                  </div>
                  {form.windows.map((w, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2 items-end">
                      <div><Label className="text-xs">Kezdés</Label><Input type="datetime-local" value={w.start} onChange={(e) => {
                        const nw = [...form.windows]; nw[i] = { ...nw[i], start: e.target.value }; setForm({ ...form, windows: nw });
                      }} /></div>
                      <div><Label className="text-xs">Vége</Label><Input type="datetime-local" value={w.end} onChange={(e) => {
                        const nw = [...form.windows]; nw[i] = { ...nw[i], end: e.target.value }; setForm({ ...form, windows: nw });
                      }} /></div>
                      <Button type="button" variant="ghost" size="icon" onClick={() => setForm({ ...form, windows: form.windows.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-3 space-y-2">
                  <Label className="text-base font-semibold">Előre-bejelentkezési idő</Label>
                  <div>
                    <Label className="text-xs">Legkésőbbi bejelentkezési idő (óra:perc)</Label>
                    <Input
                      type="time"
                      step={60}
                      value={`${String(Math.floor((form.min_lead_time_minutes || 0) / 60)).padStart(2, "0")}:${String((form.min_lead_time_minutes || 0) % 60).padStart(2, "0")}`}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(":").map((x) => parseInt(x, 10) || 0);
                        setForm({ ...form, min_lead_time_minutes: Math.max(0, h * 60 + m) });
                      }}
                    />
                    <p className="text-xs text-muted-foreground mt-1">00:00 = nincs korlát. A foglalási rendszer a szolgáltatás és az alkalmazott közül a nagyobb értéket alkalmazza.</p>
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={form.allow_instant_after_booking}
                      onChange={(e) => setForm({ ...form, allow_instant_after_booking: e.target.checked })} />
                    <span>Ha aznapra már van foglalása, a hátralévő időpontokra eltűnik az előre-bejelentkezési korlát (csak arra a napra).</span>
                  </label>
                </div>


                <Button onClick={() => {
                  const email = form.email.trim();
                  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("Érvényes e-mail cím megadása kötelező"); return; }
                  save.mutate(form);
                }} disabled={save.isPending || !form.display_name || !form.email.trim()} className="w-full">Mentés</Button>
              </div>
            </DialogContent>
          </Dialog>
          )}
          </div>
        </div>
        <StaffList staff={staff ?? []} orgId={orgId} readOnly={readOnly} onEdit={(s) => {
          const windowsArr = Array.isArray(s.availability_windows_json)
            ? (s.availability_windows_json as any[])
                .filter((w: any) => w && typeof w.start === "string" && typeof w.end === "string")
                .map((w: any) => ({ start: new Date(w.start).toISOString().slice(0,16), end: new Date(w.end).toISOString().slice(0,16) }))
            : [];
          setForm({
            id: s.id,
            full_name: s.full_name ?? "",
            display_name: s.display_name,
            email: s.email ?? "",
            phone: s.phone ?? "",
            bio: s.bio ?? "",
            active: s.active,
            ...parsePatternToForm(s.working_hours_json),
            windows: windowsArr,
            min_lead_time_minutes: s.min_lead_time_minutes ?? 0,
            allow_instant_after_booking: !!s.allow_instant_after_booking,
          });
          setOpen(true);
        }} onDelete={(id) => del.mutate(id)} />

      </section>

      
    </div>
  );
}

type AssignmentForm = {
  id?: string;
  staffProfileId: string;
  resourceId: string;
  kind: "always" | "scheduled";
  parityMode: ParityMode;
  weekly: Record<DayKey, string>;
  weeklyEven: Record<DayKey, string>;
  weeklyOdd: Record<DayKey, string>;
  windows: WindowEntry[];
};
const emptyAssignmentForm: AssignmentForm = {
  staffProfileId: "", resourceId: "", kind: "always",
  parityMode: "single",
  weekly: { ...emptyDays },
  weeklyEven: { ...emptyDays },
  weeklyOdd: { ...emptyDays },
  windows: [],
};
function assignmentRowToForm(r: any): AssignmentForm {
  const windowsArr: WindowEntry[] = Array.isArray(r.availability_windows_json)
    ? (r.availability_windows_json as any[])
        .filter((w: any) => w && typeof w.start === "string" && typeof w.end === "string")
        .map((w: any) => ({ start: new Date(w.start).toISOString().slice(0,16), end: new Date(w.end).toISOString().slice(0,16) }))
    : [];
  return {
    id: r.id,
    staffProfileId: r.staff_profile_id,
    resourceId: r.resource_id,
    kind: r.kind === "always" ? "always" : "scheduled",
    ...parsePatternToForm(r.working_hours_json),
    windows: windowsArr,
  };
}
function buildAssignmentPayload(form: AssignmentForm, orgId: string) {
  const working = buildWorkingHours({
    parityMode: form.parityMode,
    weekly: form.weekly,
    weeklyEven: form.weeklyEven,
    weeklyOdd: form.weeklyOdd,
  } as any);
  const windows = form.windows
    .filter((w) => w.start && w.end)
    .map((w) => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() }));
  return {
    id: form.id,
    organizationId: orgId,
    staffProfileId: form.staffProfileId,
    resourceId: form.resourceId,
    kind: form.kind,
    workingHours: form.kind === "scheduled" ? working : undefined,
    windows: form.kind === "scheduled" ? windows : [],
    active: true,
  };
}

function AvailabilityFields({ form, setForm, orgId }: { form: AssignmentForm; setForm: (f: AssignmentForm) => void; orgId: string }) {
  if (form.kind !== "scheduled") return null;
  return (
    <>
      <div className="border-t pt-3">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-base font-semibold">Heti hozzárendelés</Label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.parityMode === "alternating"}
              onChange={(e) => setForm({ ...form, parityMode: e.target.checked ? "alternating" : "single" })}
            />
            Váltott műszak (páros/páratlan hét)
          </label>
        </div>
        <p className="text-xs text-muted-foreground mb-2">Formátum naponként: <code>09:00-13:00,14:00-17:00</code> (üres = nincs aznap)</p>
        {form.parityMode === "single" && (
          <div>
            {(["mon","tue","wed","thu","fri","sat","sun"] as DayKey[]).map((d) => (
              <div key={d} className="grid grid-cols-[60px_1fr] items-center gap-2 mb-1">
                <Label className="text-xs uppercase">{d}</Label>
                <Input value={form.weekly[d]} onChange={(e) => setForm({ ...form, weekly: { ...form.weekly, [d]: e.target.value } })} placeholder="pl. 09:00-13:00,14:00-17:00" />
              </div>
            ))}
          </div>
        )}
        {form.parityMode === "alternating" && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold mb-1">Páros hét</div>
              {(["mon","tue","wed","thu","fri","sat","sun"] as DayKey[]).map((d) => (
                <div key={d} className="grid grid-cols-[60px_1fr] items-center gap-2 mb-1">
                  <Label className="text-xs uppercase">{d}</Label>
                  <Input value={form.weeklyEven[d]} onChange={(e) => setForm({ ...form, weeklyEven: { ...form.weeklyEven, [d]: e.target.value } })} placeholder="pl. 09:00-17:00" />
                </div>
              ))}
            </div>
            <div>
              <div className="text-sm font-semibold mb-1">Páratlan hét</div>
              {(["mon","tue","wed","thu","fri","sat","sun"] as DayKey[]).map((d) => (
                <div key={d} className="grid grid-cols-[60px_1fr] items-center gap-2 mb-1">
                  <Label className="text-xs uppercase">{d}</Label>
                  <Input value={form.weeklyOdd[d]} onChange={(e) => setForm({ ...form, weeklyOdd: { ...form.weeklyOdd, [d]: e.target.value } })} placeholder="pl. 12:00-20:00" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t pt-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <Label className="text-base font-semibold">Egyedi hozzárendelés</Label>
            <p className="text-xs text-muted-foreground">Egyedi időablakok. Ha üres → csak a heti minta számít. Ha van legalább egy ablak → CSAK ezeken belül érvényes.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, windows: [...form.windows, { start: "", end: "" }] })}>
            <Plus className="w-3 h-3 mr-1" />Új
          </Button>
        </div>
        {form.windows.map((w, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2 items-end">
            <div><Label className="text-xs">Kezdés</Label><Input type="datetime-local" value={w.start} onChange={(e) => {
              const nw = [...form.windows]; nw[i] = { ...nw[i], start: e.target.value }; setForm({ ...form, windows: nw });
            }} /></div>
            <div><Label className="text-xs">Vége</Label><Input type="datetime-local" value={w.end} onChange={(e) => {
              const nw = [...form.windows]; nw[i] = { ...nw[i], end: e.target.value }; setForm({ ...form, windows: nw });
            }} /></div>
            <Button type="button" variant="ghost" size="icon" onClick={() => setForm({ ...form, windows: form.windows.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
      </div>

      <EffectiveAvailabilityPanel form={form} setForm={setForm} orgId={orgId} />
    </>
  );

}

function EffectiveAvailabilityPanel({ form, setForm, orgId }: { form: AssignmentForm; setForm: (f: AssignmentForm) => void; orgId: string }) {
  const compute = useServerFn(computeStaffResourceEffectiveAvailability);
  const [preview, setPreview] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const canRun = !!form.staffProfileId && !!form.resourceId;

  const run = async () => {
    if (!canRun) return;
    setLoading(true);
    try {
      const res = await compute({ data: {
        organizationId: orgId,
        staffProfileId: form.staffProfileId,
        resourceId: form.resourceId,
        excludeAssignmentId: form.id,
        days: 56,
      } as any });
      setPreview(res);
    } catch (e: any) {
      toast.error(e.message ?? "Számítási hiba");
    } finally {
      setLoading(false);
    }
  };

  const applyToWindows = () => {
    if (!preview?.windows) return;
    const toLocalInput = (iso: string) => {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const windows = preview.windows.map((w: any) => ({ start: toLocalInput(w.start), end: toLocalInput(w.end) }));
    // töröljük a heti mintát, hogy csak a kiszámolt ablakok határozzák meg a rendelkezésre állást
    setForm({
      ...form,
      kind: "scheduled",
      parityMode: "single",
      weekly: { mon:"", tue:"", wed:"", thu:"", fri:"", sat:"", sun:"" },
      weeklyEven: { mon:"", tue:"", wed:"", thu:"", fri:"", sat:"", sun:"" },
      weeklyOdd: { mon:"", tue:"", wed:"", thu:"", fri:"", sat:"", sun:"" },
      windows,
    });
    toast.success(`${windows.length} időablak beillesztve a következő ${preview.days?.length ?? 0} napra.`);
  };

  return (
    <div className="border-t pt-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Label className="text-base font-semibold">Számolt rendelkezésre állás (ütközés-szűréssel)</Label>
          <p className="text-xs text-muted-foreground">
            A munkatárs heti rendelkezésre állásából indul, kivonja a másik szoba/szék hozzárendelés ütközéseit és az erőforrás meglévő foglalásait.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={run} disabled={!canRun || loading}>
            {loading ? "Számolás…" : "Beolvasás / Frissítés"}
          </Button>
          {preview && (
            <Button type="button" size="sm" onClick={applyToWindows}>
              Időablakokba másol
            </Button>
          )}
        </div>
      </div>
      {!canRun && <p className="text-xs text-muted-foreground">Válassz munkatársat és erőforrást először.</p>}
      {preview && (
        <div className="rounded border bg-muted/30 p-2 max-h-80 overflow-y-auto">
          <div className="text-xs text-muted-foreground mb-2">
            {preview.staffName} → {preview.resourceName} · zóna: {preview.tz} · kapacitás: {preview.capacity}
          </div>
          <TooltipProvider delayDuration={200}>
            <div className="space-y-1">
              {preview.days.map((d: any) => {
                const hasAvail = d.segments.some((s: any) => s.status === "available");
                const blocked = d.segments.filter((s: any) => s.status === "blocked");
                const avail = d.segments.filter((s: any) => s.status === "available");
                const reasonText = blocked.length > 0
                  ? blocked.map((s: any) => {
                      const hs = new Date(s.startISO), he = new Date(s.endISO);
                      const fmt = (x: Date) => `${String(x.getHours()).padStart(2,"0")}:${String(x.getMinutes()).padStart(2,"0")}`;
                      return `${fmt(hs)}–${fmt(he)}: ${s.reasons.join("; ")}`;
                    }).join("\n")
                  : (hasAvail ? "Nincs korlátozás." : "Aznap nincs heti munkaidő.");
                const availText = avail.length > 0
                  ? avail.map((s: any) => {
                      const hs = new Date(s.startISO), he = new Date(s.endISO);
                      const fmt = (x: Date) => `${String(x.getHours()).padStart(2,"0")}:${String(x.getMinutes()).padStart(2,"0")}`;
                      return `${fmt(hs)}–${fmt(he)}`;
                    }).join(", ")
                  : "—";
                return (
                  <Tooltip key={d.dateISO}>
                    <TooltipTrigger asChild>
                      <div className={`flex items-center justify-between text-xs rounded px-2 py-1 cursor-help ${hasAvail ? "bg-background" : "bg-destructive/10"}`}>
                        <span className="font-mono">{d.dateISO} ({d.weekdayKey})</span>
                        <span className={hasAvail ? "text-foreground" : "text-muted-foreground italic"}>{availText}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-sm whitespace-pre-line text-xs">
                      {reasonText}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}


function AssignServicesDialog({ staff, orgId }: { staff: any; orgId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [onlyActive, setOnlyActive] = useState(true);

  const { data: services } = useQuery({
    queryKey: ["services-all", orgId],
    enabled: open,
    queryFn: async () => (await supabase.from("services").select("id, name, active, tags, category_id").eq("organization_id", orgId).order("name")).data ?? [],
  });
  const { data: categories } = useQuery({
    queryKey: ["service-categories-all", orgId],
    enabled: open,
    queryFn: async () => (await supabase.from("service_categories").select("id, name").eq("organization_id", orgId).order("sort_order")).data ?? [],
  });
  const [categoryId, setCategoryId] = useState<string>("all");
  const { data: links } = useQuery({
    queryKey: ["staff-services-of", staff.id],
    enabled: open,
    queryFn: async () => (await supabase.from("staff_services").select("id, service_id").eq("staff_profile_id", staff.id)).data ?? [],
  });

  const toggle = useMutation({
    mutationFn: async ({ serviceId, checked }: { serviceId: string; checked: boolean }) => {
      if (checked) {
        const { error } = await supabase.from("staff_services").insert({ service_id: serviceId, staff_profile_id: staff.id });
        if (error && !error.message.includes("duplicate")) throw error;
      } else {
        const { error } = await supabase.from("staff_services").delete().eq("service_id", serviceId).eq("staff_profile_id", staff.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-services-of", staff.id] });
      qc.invalidateQueries({ queryKey: ["all_staff_services", orgId] });
      qc.invalidateQueries({ queryKey: ["staff_services"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const linkedIds = new Set((links ?? []).map((l: any) => l.service_id));

  const allTags = Array.from(new Set((services ?? []).flatMap((s: any) => Array.isArray(s.tags) ? s.tags : []))).sort();
  const q = searchQuery.trim().toLowerCase();
  const filtered = (services ?? []).filter((s: any) => {
    if (onlyActive && !s.active) return false;
    if (categoryId !== "all" && s.category_id !== categoryId) return false;
    if (tagFilter.length > 0) {
      const tags = Array.isArray(s.tags) ? s.tags : [];
      if (!tagFilter.every((t) => tags.includes(t))) return false;
    }
    if (q && !s.name.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Szolgáltatások</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{staff.display_name} — szolgáltatások</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Pipáld be, mely szolgáltatásokat végezheti.</p>

        <div className="space-y-2 sticky top-0 bg-background pb-2 z-10">
          <div className="flex gap-2 items-center">
            <Input
              placeholder="Keresés név alapján…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
            {searchQuery && (
              <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>×</Button>
            )}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            {(categories ?? []).length > 0 && (
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="h-8 w-auto min-w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Minden kategória</SelectItem>
                  {(categories ?? []).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
              Csak aktív
            </label>
          </div>
          {allTags.length > 0 && (
            <div className="flex gap-1 flex-wrap items-center">
              <span className="text-xs text-muted-foreground mr-1">Címkék:</span>
              {allTags.map((t) => {
                const active = tagFilter.includes(t);
                return (
                  <Badge
                    key={t}
                    variant={active ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => setTagFilter(active ? tagFilter.filter((x) => x !== t) : [...tagFilter, t])}
                  >
                    {t}
                  </Badge>
                );
              })}
              {tagFilter.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setTagFilter([])}>Szűrő törlése</Button>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1 max-h-[55vh] overflow-y-auto">
          {filtered.length === 0 && <p className="text-sm text-muted-foreground">Nincs egyező szolgáltatás.</p>}
          {filtered.map((sv: any) => (
            <label key={sv.id} className="flex items-center gap-2 p-2 hover:bg-muted/40 rounded text-sm">
              <input
                type="checkbox"
                checked={linkedIds.has(sv.id)}
                disabled={toggle.isPending}
                onChange={(e) => toggle.mutate({ serviceId: sv.id, checked: e.target.checked })}
              />
              <span className="flex-1">{sv.name} {!sv.active && <span className="text-xs text-muted-foreground">(inaktív)</span>}</span>
            </label>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}





function StaffList({ staff, orgId, readOnly, onEdit, onDelete }: { staff: any[]; orgId: string; readOnly: boolean; onEdit: (s: any) => void; onDelete: (id: string) => void }) {
  const listSra = useServerFn(listStaffResourceAssignments);
  const { data: assignments } = useQuery({
    queryKey: ["sra-list", orgId],
    queryFn: () => listSra({ data: { organizationId: orgId } }),
  });
  const { data: resources } = useQuery({
    queryKey: ["res-all", orgId],
    queryFn: async () => (await supabase.from("resources").select("id, name, type").eq("organization_id", orgId).eq("active", true)).data ?? [],
  });

  return (
    <div className="space-y-2">
      {staff.map((s: any) => {
        const assigned = (assignments ?? []).filter((a: any) => a.staff_profile_id === s.id);
        return (
          <Card key={s.id} className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{s.display_name} {!s.active && <span className="text-xs text-muted-foreground">(inaktív)</span>}</div>
                {s.full_name && <div className="text-xs text-muted-foreground">Teljes név: {s.full_name}</div>}
                <div className="text-xs text-muted-foreground space-x-2">
                  {s.email ? <span className="font-mono">{s.email}</span> : <span className="italic">nincs e-mail megadva</span>}
                  {s.phone && <span className="font-mono">· {s.phone}</span>}
                </div>
                {s.bio && <div className="text-sm text-muted-foreground line-clamp-1 mt-1">{s.bio}</div>}
              </div>
              {!readOnly && (
                <div className="flex gap-2">
                  <AssignServicesDialog staff={s} orgId={orgId} />
                  <AssignResourcesDialog staff={s} orgId={orgId} resources={resources ?? []} assignments={assigned} />
                  <Button variant="ghost" size="icon" onClick={() => onEdit(s)}><Pencil className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => { if (confirm("Biztos?")) onDelete(s.id); }}><Trash2 className="w-4 h-4" /></Button>
                </div>
              )}
            </div>
            {assigned.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {assigned.map((a: any) => (
                  <Badge key={a.id} variant="secondary" className="text-xs">
                    {a.resources?.name}
                    <span className="ml-1 opacity-60">
                      {a.kind === "always" ? "" : a.kind === "weekly" ? "(heti)" : "(időszak)"}
                    </span>
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        );
      })}
      {staff.length === 0 && <p className="text-muted-foreground">Még nincs munkatárs profil.</p>}
    </div>
  );
}

function AssignResourcesDialog({ staff, orgId, resources, assignments }: { staff: any; orgId: string; resources: any[]; assignments: any[] }) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertStaffResourceAssignment);
  const del = useServerFn(deleteStaffResourceAssignment);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: async ({ resourceId, checked, existingId }: { resourceId: string; checked: boolean; existingId?: string }) => {
      if (checked) {
        await upsert({ data: {
          organizationId: orgId, staffProfileId: staff.id, resourceId, kind: "always", windows: [], active: true,
        }});
      } else if (existingId) {
        await del({ data: { id: existingId } });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sra-list", orgId] }),
    onError: (e: any) => toast.error(e.message),
  });

  const saveSchedule = useMutation({
    mutationFn: async (form: AssignmentForm) => {
      await upsert({ data: buildAssignmentPayload(form, orgId) as any });
    },
    onSuccess: () => { toast.success("Mentve"); qc.invalidateQueries({ queryKey: ["sra-list", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Erőforrások</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{staff.display_name} — erőforrások</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Pipáld be, mely erőforrásokat használhatja. A "Beállít" gombbal ugyanúgy adhatsz meg rendelkezésre állást, mint a munkatárs profilnál (heti munkaidő váltott műszakkal + időablakok). Szoba/szék típusnál egy időpontban csak egyhez lehet hozzárendelni.</p>
        <div className="space-y-1">
          {resources.map((r: any) => {
            const existing = assignments.find((a: any) => a.resource_id === r.id);
            const checked = !!existing;
            const isOpen = expanded === r.id;
            return (
              <div key={r.id} className="rounded border">
                <div className="flex items-center gap-2 p-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={toggle.isPending}
                    title="Állandó hozzárendelés (a munkatárs teljes rendelkezési idejére)"
                    onChange={(e) => toggle.mutate({ resourceId: r.id, checked: e.target.checked, existingId: existing?.id })}
                  />
                  <span className="text-xs text-muted-foreground">Állandó</span>
                  <span className="flex-1">{r.name} <span className="text-xs text-muted-foreground">({r.type})</span></span>
                  {existing && (
                    <Badge variant="outline" className="text-xs">
                      {existing.kind === "always" ? "állandó" : "időzített"}
                    </Badge>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setExpanded(isOpen ? null : r.id)}>
                    {isOpen ? "Bezár" : "Beállít"}
                  </Button>
                </div>
                {isOpen && (
                  <InlineAvailabilityEditor
                    key={(existing?.id ?? "new") + "-" + (existing?.kind ?? "scheduled")}
                    assignment={existing ?? null}
                    resourceId={r.id}
                    staff={staff}
                    orgId={orgId}
                    onSave={(form) => saveSchedule.mutate(form)}
                    busy={saveSchedule.isPending}
                  />
                )}
              </div>
            );
          })}
          {resources.length === 0 && <p className="text-sm text-muted-foreground">Még nincs aktív erőforrás.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InlineAvailabilityEditor({ assignment, resourceId, staff, orgId, onSave, busy }: { assignment: any | null; resourceId: string; staff: any; orgId: string; onSave: (f: AssignmentForm) => void; busy: boolean }) {
  const [form, setForm] = useState<AssignmentForm>(() =>
    assignment
      ? assignmentRowToForm(assignment)
      : { ...emptyAssignmentForm, staffProfileId: staff.id, resourceId, kind: "scheduled" },
  );
  const compute = useServerFn(computeStaffResourceEffectiveAvailability);
  const [autoLoaded, setAutoLoaded] = useState(false);

  // Auto-load effektív rendelkezésre állás megnyitáskor, ha még nincs egyedi időablak.
  useEffect(() => {
    if (autoLoaded) return;
    setAutoLoaded(true);
    if (form.windows.length > 0) return;
    (async () => {
      try {
        const res = await compute({ data: {
          organizationId: orgId,
          staffProfileId: staff.id,
          resourceId,
          excludeAssignmentId: assignment?.id,
          days: 56,
        } as any });
        if (res?.windows?.length) {
          const toLocal = (iso: string) => {
            const d = new Date(iso);
            const pad = (n: number) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
          };
          setForm((f) => ({
            ...f,
            kind: "scheduled",
            parityMode: "single",
            weekly: { mon:"", tue:"", wed:"", thu:"", fri:"", sat:"", sun:"" },
            weeklyEven: { mon:"", tue:"", wed:"", thu:"", fri:"", sat:"", sun:"" },
            weeklyOdd: { mon:"", tue:"", wed:"", thu:"", fri:"", sat:"", sun:"" },
            windows: res.windows.map((w: any) => ({ start: toLocal(w.start), end: toLocal(w.end) })),
          }));
        }
      } catch (e: any) {
        toast.error(e.message ?? "Számítási hiba");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyFromStaff = () => {
    const windowsArr: WindowEntry[] = Array.isArray(staff?.availability_windows_json)
      ? (staff.availability_windows_json as any[])
          .filter((w: any) => w && typeof w.start === "string" && typeof w.end === "string")
          .map((w: any) => ({ start: new Date(w.start).toISOString().slice(0,16), end: new Date(w.end).toISOString().slice(0,16) }))
      : [];
    setForm({
      ...form,
      kind: "scheduled",
      ...parsePatternToForm(staff?.working_hours_json),
      windows: windowsArr,
    });
    toast.success("Munkatárs rendelkezésre állása bemásolva — szerkesztheted és mentheted.");
  };

  return (
    <div className="space-y-3 p-3 border-t bg-muted/30">
      <p className="text-xs text-muted-foreground">A rendszer automatikusan kitöltötte az időablakokat a munkatárs szabad ideje és az erőforrás szabad ideje metszetéből (másik szoba/szék ütközések kivonva). Manuálisan módosíthatod, de mentéskor a szerver ellenőrzi az ütközéseket.</p>
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <Label className="text-xs">Rendelkezésre állás</Label>
          <Select value={form.kind} onValueChange={(v: any) => setForm({ ...form, kind: v })}>
            <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="always">Állandó (időkorlát nélkül)</SelectItem>
              <SelectItem value="scheduled">Időzített (heti hozzárendelés + egyedi ablakok)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={copyFromStaff}>
          <Copy className="w-3 h-3 mr-1" />Munkatárs rendelkezésre állásának másolása
        </Button>
      </div>
      <AvailabilityFields form={form} setForm={setForm} orgId={orgId} />
      <Button size="sm" onClick={() => onSave(form)} disabled={busy}>Rendelkezésre állás mentése</Button>
    </div>
  );
}


