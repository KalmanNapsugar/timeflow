import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  computeStaffResourceEffectiveAvailability, syncAssignmentsToStaffAvailability,
} from "@/lib/staff-resources.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { detectAffectedBookings } from "@/lib/conflicts.functions";
import { ConflictDialog as BookingImpactDialog, type ConflictItem as BookingImpactItem } from "@/components/ConflictDialog";



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
    const v = normalizeTimeRangeInput(weekly[d], true).trim();
    if (!v) { out[d] = null; continue; }
    const ranges = v.split(",")
      .map(s => s.trim().split("-").map(x => x.trim()))
      .filter(p => p.length === 2 && isCanonicalTime(p[0]) && isCanonicalTime(p[1]));
    out[d] = ranges.length ? ranges : null;
  }
  return out;
}

function isCanonicalTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatTimeToken(token: string, forceComplete = false): { text: string; complete: boolean } {
  const raw = token.trim();
  if (!raw) return { text: "", complete: false };
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  const colonMatch = raw.match(/^(\d{1,2}):(\d{0,2})$/);
  if (colonMatch) {
    const [, hRaw, mRaw] = colonMatch;
    if (mRaw.length < 2 && !forceComplete) return { text: `${pad(clamp(parseInt(hRaw, 10), 0, 23))}:${mRaw}`, complete: false };
    return { text: `${pad(clamp(parseInt(hRaw, 10), 0, 23))}:${pad(clamp(parseInt(mRaw.padEnd(2, "0"), 10), 0, 59))}`, complete: true };
  }
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (!digits) return { text: "", complete: false };
  const canComplete = forceComplete || digits.length === 4;
  if (!canComplete) return { text: digits, complete: false };
  const hourRaw = digits.length <= 2 ? digits : digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
  const minuteRaw = digits.length <= 2 ? "00" : digits.length === 3 ? digits.slice(1) : digits.slice(2);
  return { text: `${pad(clamp(parseInt(hourRaw, 10), 0, 23))}:${pad(clamp(parseInt(minuteRaw, 10), 0, 59))}`, complete: true };
}

function normalizeTimeRangeInput(raw: string, finalize = false): string {
  if (!raw.trim()) return "";
  return raw.split(",").map((part) => {
    const trimmed = part.trim();
    if (!trimmed) return "";
    const hasDash = trimmed.includes("-");
    const [startRaw, endRaw = ""] = trimmed.split("-", 2);
    const start = formatTimeToken(startRaw, hasDash || finalize);
    if (!start.text) return "";
    if (!start.complete) return start.text;
    const end = formatTimeToken(endRaw, finalize);
    if (!hasDash && !end.text) return `${start.text}-`;
    if (!end.text) return `${start.text}-`;
    return end.complete ? `${start.text}-${end.text},` : `${start.text}-${end.text}`;
  }).join("");
}

function WeeklyTimeInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <Input
      value={value}
      onChange={(e) => {
        const inputType = (e.nativeEvent as InputEvent).inputType;
        if (inputType === "deleteContentBackward" && value.endsWith(",") && e.target.value === value.slice(0, -1)) {
          onChange(e.target.value);
          return;
        }
        onChange(normalizeTimeRangeInput(e.target.value));
      }}
      onBlur={(e) => onChange(normalizeTimeRangeInput(e.target.value, true))}
      placeholder={placeholder}
      inputMode="numeric"
    />
  );
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
  const [bookingImpact, setBookingImpact] = useState<BookingImpactItem[] | null>(null);
  const detect = useServerFn(detectAffectedBookings);

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
        try { await syncAssignmentsToStaffAvailability({ data: { staffProfileId: f.id } }); } catch (e) { /* non-fatal */ }
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
                          <WeeklyTimeInput value={form.weekly[d]} onChange={(value) => setForm({ ...form, weekly: { ...form.weekly, [d]: value } })} placeholder="pl. 09:00-13:00,14:00-17:00" />
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
                            <WeeklyTimeInput value={form.weeklyEven[d]} onChange={(value) => setForm({ ...form, weeklyEven: { ...form.weeklyEven, [d]: value } })} placeholder="pl. 09:00-17:00" />
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className="text-sm font-semibold mb-1">Páratlan hét</div>
                        {(["mon","tue","wed","thu","fri","sat","sun"] as DayKey[]).map((d) => (
                          <div key={d} className="grid grid-cols-[60px_1fr] items-center gap-2 mb-1">
                            <Label className="text-xs uppercase">{d}</Label>
                            <WeeklyTimeInput value={form.weeklyOdd[d]} onChange={(value) => setForm({ ...form, weeklyOdd: { ...form.weeklyOdd, [d]: value } })} placeholder="pl. 12:00-20:00" />
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


                <Button onClick={async () => {
                  const email = form.email.trim();
                  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("Érvényes e-mail cím megadása kötelező"); return; }
                  if (form.id && orgId) {
                    try {
                      const newWh = buildWorkingHours(form);
                      const newWins = form.windows.filter(w => w.start && w.end).map(w => ({
                        start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString(),
                      }));
                      const res: any = await detect({ data: {
                        organizationId: orgId, scope: "staff_hours", staffProfileId: form.id,
                        draftStaff: { working_hours_json: newWh, availability_windows_json: newWins },
                      } });
                      if (res?.conflicts?.length > 0) { setBookingImpact(res.conflicts as BookingImpactItem[]); return; }
                    } catch { /* nem blokkol */ }
                  }
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

      <BookingImpactDialog
        open={!!bookingImpact}
        onOpenChange={(v) => { if (!v) setBookingImpact(null); }}
        conflicts={bookingImpact ?? []}
        title="A módosítás érintene jövőbeni foglalásokat"
        description="Az új munkaidővel / időablakokkal az alábbi foglalások kívül esnének. Folytatod a mentést?"
        onConfirm={() => { setBookingImpact(null); save.mutate(form); }}
        onCancel={() => setBookingImpact(null)}
        pending={save.isPending}
      />
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
                <WeeklyTimeInput value={form.weekly[d]} onChange={(value) => setForm({ ...form, weekly: { ...form.weekly, [d]: value } })} placeholder="pl. 09:00-13:00,14:00-17:00" />
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
                  <WeeklyTimeInput value={form.weeklyEven[d]} onChange={(value) => setForm({ ...form, weeklyEven: { ...form.weeklyEven, [d]: value } })} placeholder="pl. 09:00-17:00" />
                </div>
              ))}
            </div>
            <div>
              <div className="text-sm font-semibold mb-1">Páratlan hét</div>
              {(["mon","tue","wed","thu","fri","sat","sun"] as DayKey[]).map((d) => (
                <div key={d} className="grid grid-cols-[60px_1fr] items-center gap-2 mb-1">
                  <Label className="text-xs uppercase">{d}</Label>
                  <WeeklyTimeInput value={form.weeklyOdd[d]} onChange={(value) => setForm({ ...form, weeklyOdd: { ...form.weeklyOdd, [d]: value } })} placeholder="pl. 12:00-20:00" />
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
            <p className="text-xs text-muted-foreground">Egyedi időablakok csak az Új gombbal jönnek létre. Ha üres → csak a heti minta számít; ha van ablak → PLUSZBAN érvényesül a heti mintához képest.</p>
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
    // Eszköz típust nem listázzuk: az nem munkatárshoz rendelendő, hanem szolgáltatáshoz / szobához-székhez.
    queryFn: async () => {
      const { data } = await supabase.from("resources").select("id, name, type").eq("organization_id", orgId).eq("active", true).neq("type", "equipment");
      return data ?? [];
    },
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
  const [conflict, setConflict] = useState<ConflictPayload | null>(null);
  const [removeImpact, setRemoveImpact] = useState<{ items: BookingImpactItem[]; existingId: string } | null>(null);

  const handleError = (e: any) => {
    const parsed = parseConflict(e?.message);
    if (parsed) setConflict(parsed);
    else toast.error(e?.message ?? "Hiba történt");
  };

  const toggle = useMutation({
    mutationFn: async ({ resourceId, checked, existingId, force }: { resourceId: string; checked: boolean; existingId?: string; force?: boolean }) => {
      if (checked) {
        await upsert({ data: {
          id: existingId, organizationId: orgId, staffProfileId: staff.id, resourceId, kind: "always", windows: [], active: true,
        }});
      } else if (existingId) {
        if (!force) {
          const { data: bks } = await supabase.from("bookings")
            .select("id, start_at, services(name), customers(full_name), staff_profiles(display_name)")
            .eq("staff_profile_id", staff.id)
            .eq("resource_id", resourceId)
            .in("status", ["confirmed", "checked_in", "pending_payment"])
            .gte("start_at", new Date().toISOString());
          if (bks && bks.length > 0) {
            const items: BookingImpactItem[] = bks.map((b: any) => ({
              kind: "missing_assignment",
              message: `${b.staff_profiles?.display_name ?? staff.display_name}: a hozzárendelés megszüntetésével érintett.`,
              bookingId: b.id, when: b.start_at, who: b.customers?.full_name, what: b.services?.name,
            }));
            setRemoveImpact({ items, existingId });
            throw new Error("__IMPACT_DEFERRED__");
          }
        }
        await del({ data: { id: existingId } });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sra-list", orgId] }),
    onError: (e: any) => { if (e?.message !== "__IMPACT_DEFERRED__") handleError(e); },
  });

  const saveSchedule = useMutation({
    mutationFn: async (form: AssignmentForm) => {
      await upsert({ data: buildAssignmentPayload(form, orgId) as any });
    },
    onSuccess: () => { toast.success("Mentve"); qc.invalidateQueries({ queryKey: ["sra-list", orgId] }); },
    onError: handleError,
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
            const checked = existing?.kind === "always";
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
        <ConflictDialog conflict={conflict} onClose={() => setConflict(null)} />
        <BookingImpactDialog
          open={!!removeImpact}
          onOpenChange={(v) => { if (!v) setRemoveImpact(null); }}
          conflicts={removeImpact?.items ?? []}
          title="A hozzárendelés megszüntetése érint foglalásokat"
          description="Az alábbi jövőbeni foglalások a hozzárendelés nélkül maradnak. Folytatod?"
          onConfirm={() => {
            const r = removeImpact;
            setRemoveImpact(null);
            if (r) {
              // resourceId-t a meglévő assignment alapján találjuk meg
              const a = assignments.find((x: any) => x.id === r.existingId);
              if (a) toggle.mutate({ resourceId: a.resource_id, checked: false, existingId: r.existingId, force: true });
            }
          }}
          onCancel={() => setRemoveImpact(null)}
          pending={toggle.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}

// ============== Conflict comparison helpers ==============

type ConflictSide = {
  id?: string;
  staffName: string;
  resourceName: string;
  resourceType: string;
  kind: string;
  working_hours_json: any;
  availability_windows_json: any[] | null;
  staffWorkingHours?: any;
  staffWindows?: any[] | null;
};
type ConflictPayload = {
  type: "exclusive" | "capacity";
  message: string;
  candidate: ConflictSide;
  conflicts: ConflictSide[];
};

function parseConflict(msg?: string): ConflictPayload | null {
  if (!msg || typeof msg !== "string") return null;
  const i = msg.indexOf("__CONFLICT__:");
  if (i < 0) return null;
  try { return JSON.parse(msg.slice(i + "__CONFLICT__:".length)) as ConflictPayload; } catch { return null; }
}

const DAY_LABEL_HU: Record<string, string> = { mon: "H", tue: "K", wed: "Sze", thu: "Cs", fri: "P", sat: "Szo", sun: "V" };

function weeklyDaysList(pat: any): { day: string; text: string }[] {
  const out: { day: string; text: string }[] = [];
  if (!pat) return out;
  for (const d of ["mon","tue","wed","thu","fri","sat","sun"]) {
    const v = pat[d];
    if (!v) continue;
    let text = "";
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string") text = `${v[0]}–${v[1]}`;
    else if (Array.isArray(v)) text = v.map((p: any) => Array.isArray(p) ? `${p[0]}–${p[1]}` : "").filter(Boolean).join(", ");
    if (text) out.push({ day: DAY_LABEL_HU[d] ?? d, text });
  }
  return out;
}

function summarizeWeekly(wh: any): { label: string; days: { day: string; text: string }[] }[] {
  if (!wh) return [];
  if (wh.mode === "alternating" && wh.alt) {
    return [
      { label: "Páros hét", days: weeklyDaysList(wh.alt.even) },
      { label: "Páratlan hét", days: weeklyDaysList(wh.alt.odd) },
    ];
  }
  return [{ label: "Heti", days: weeklyDaysList(wh) }];
}

function formatWindow(w: any): string {
  try {
    const s = new Date(w.start);
    const e = new Date(w.end);
    const f = (d: Date) => d.toLocaleString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `${f(s)} – ${f(e)}`;
  } catch { return ""; }
}

function ConflictSideCard({ title, side, tone }: { title: string; side: ConflictSide; tone: "active" | "conflict" }) {
  const weekly = summarizeWeekly(side.working_hours_json);
  const hasAnyWeekly = weekly.some((b) => b.days.length > 0);
  const wins = Array.isArray(side.availability_windows_json) ? side.availability_windows_json : [];
  const staffWeekly = summarizeWeekly(side.staffWorkingHours);
  const hasStaffWeekly = staffWeekly.some((b) => b.days.length > 0);
  const staffWins = Array.isArray(side.staffWindows) ? side.staffWindows : [];
  return (
    <Card className={`p-3 space-y-2 border ${tone === "active" ? "border-primary" : "border-destructive"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        <Badge variant={tone === "active" ? "default" : "destructive"} className="text-xs">{side.kind === "always" ? "állandó" : "időzített"}</Badge>
      </div>
      <div className="text-sm font-medium">{side.staffName} → {side.resourceName} <span className="text-xs text-muted-foreground">({side.resourceType})</span></div>

      {side.kind === "always" ? (
        <div className="text-xs text-muted-foreground">
          Állandó hozzárendelés — a munkatárs <strong>teljes rendelkezésre állásának</strong> idejére foglalja az erőforrást.
        </div>
      ) : (
        <>
          {hasAnyWeekly ? (
            <div className="space-y-1">
              {weekly.map((b, i) => b.days.length > 0 && (
                <div key={i}>
                  <div className="text-xs font-medium text-muted-foreground">{b.label}</div>
                  <div className="text-xs grid grid-cols-[2rem_1fr] gap-x-2">
                    {b.days.map((d, j) => (
                      <div key={`row${j}`} className="contents">
                        <span className="font-mono">{d.day}</span>
                        <span>{d.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Nincs heti minta.</div>
          )}
          {wins.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground">Egyedi időablakok ({wins.length})</div>
              <ul className="text-xs list-disc list-inside">
                {wins.slice(0, 6).map((w, i) => (<li key={i}>{formatWindow(w)}</li>))}
                {wins.length > 6 && <li>… és még {wins.length - 6}</li>}
              </ul>
            </div>
          )}
        </>
      )}

      {(hasStaffWeekly || staffWins.length > 0) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Munkatárs rendelkezésre állása</summary>
          <div className="mt-1 space-y-1 pl-2 border-l">
            {staffWeekly.map((b, i) => b.days.length > 0 && (
              <div key={i}>
                <div className="font-medium text-muted-foreground">{b.label}</div>
                <div className="grid grid-cols-[2rem_1fr] gap-x-2">
                  {b.days.map((d, j) => (
                    <div key={`srow${j}`} className="contents">
                      <span className="font-mono">{d.day}</span>
                      <span>{d.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {staffWins.length > 0 && (
              <ul className="list-disc list-inside">
                {staffWins.slice(0, 4).map((w: any, i: number) => (<li key={i}>{formatWindow(w)}</li>))}
                {staffWins.length > 4 && <li>… és még {staffWins.length - 4}</li>}
              </ul>
            )}
          </div>
        </details>
      )}
    </Card>
  );
}

function ConflictDialog({ conflict, onClose }: { conflict: ConflictPayload | null; onClose: () => void }) {
  return (
    <Dialog open={!!conflict} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-destructive">Ütközés a hozzárendelésnél</DialogTitle>
        </DialogHeader>
        {conflict && (
          <div className="space-y-3">
            <p className="text-sm">{conflict.message}</p>
            <p className="text-xs text-muted-foreground">
              Hasonlítsd össze az új és a meglévő beállítást — módosítsd valamelyik heti mintáját, időablakát vagy típusát (Állandó / Időzített), hogy ne fedjék át egymást.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <ConflictSideCard title="Új beállítás (mentés alatt)" side={conflict.candidate} tone="active" />
              <div className="space-y-3">
                {conflict.conflicts.map((c, i) => (
                  <ConflictSideCard key={c.id ?? i} title={`Meglévő ütköző beállítás${conflict.conflicts.length > 1 ? ` ${i + 1}` : ""}`} side={c} tone="conflict" />
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>Bezárás</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InlineAvailabilityEditor({ assignment, resourceId, staff, orgId, onSave, busy }: { assignment: any | null; resourceId: string; staff: any; orgId: string; onSave: (f: AssignmentForm) => void; busy: boolean }) {
  const [form, setForm] = useState<AssignmentForm>(() => {
    if (assignment) return assignmentRowToForm(assignment);
    // Új hozzárendelésnél a munkatárs mentett heti munkaidejét és időablakait
    // előtöltjük (alapérték helyett), hogy ne kelljen újra begépelni.
    const windowsArr: WindowEntry[] = Array.isArray(staff?.availability_windows_json)
      ? (staff.availability_windows_json as any[])
          .filter((w: any) => w && typeof w.start === "string" && typeof w.end === "string")
          .map((w: any) => ({ start: new Date(w.start).toISOString().slice(0,16), end: new Date(w.end).toISOString().slice(0,16) }))
      : [];
    return {
      ...emptyAssignmentForm,
      staffProfileId: staff.id,
      resourceId,
      kind: "scheduled",
      ...parsePatternToForm(staff?.working_hours_json),
      windows: windowsArr,
    };
  });

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
      <p className="text-xs text-muted-foreground">A heti / kétheti minta és az egyedi időablakok <strong>együtt, additívan</strong> érvényesülnek (az időablak PLUSZ rendelkezésre állást ad a heti mintához). Mentéskor a szerver ellenőrzi az ütközéseket.</p>
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


