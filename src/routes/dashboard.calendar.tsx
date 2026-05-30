import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { updateBookingTime, cancelBookingAsStaff, updateBookingNote, updateBookingPaymentStatus } from "@/lib/bookings.functions";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/dashboard/calendar")({
  component: CalendarPage,
});

type ViewMode = "day" | "week" | "month" | "agenda";
const RESOURCE_TYPES = ["szoba", "szék", "eszköz", "egyéb"] as const;

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d: Date) {
  const date = startOfDay(d);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
}
function startOfMonth(d: Date) { const x = new Date(d.getFullYear(), d.getMonth(), 1); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number) { return new Date(d.getTime() + n * 86400000); }

function CalendarPage() {
  const { ownedOrgIds, readOnly, effectiveRole, user, viewingStaffProfileId } = useAuth();
  const orgId = ownedOrgIds[0];
  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

  // Szűrők (csak owner)
  const isOwnerView = (effectiveRole === "owner" || effectiveRole === "platform_admin") && !viewingStaffProfileId;
  const isStaffView = effectiveRole === "staff" || !!viewingStaffProfileId;
  const [filterResourceIds, setFilterResourceIds] = useState<string[]>([]);
  const [filterResourceTypes, setFilterResourceTypes] = useState<string[]>([]);
  const [filterStaffIds, setFilterStaffIds] = useState<string[]>([]);
  const [filterServiceIds, setFilterServiceIds] = useState<string[]>([]);
  const hasAnyFilter = filterResourceIds.length + filterResourceTypes.length + filterStaffIds.length + filterServiceIds.length > 0;
  const clearFilters = () => { setFilterResourceIds([]); setFilterResourceTypes([]); setFilterStaffIds([]); setFilterServiceIds([]); };

  // Range
  let rangeStart: Date, rangeEnd: Date;
  if (view === "day") { rangeStart = startOfDay(anchor); rangeEnd = addDays(rangeStart, 1); }
  else if (view === "week") { rangeStart = startOfWeek(anchor); rangeEnd = addDays(rangeStart, 7); }
  else if (view === "month") { rangeStart = startOfMonth(anchor); rangeEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1); }
  else { rangeStart = startOfDay(anchor); rangeEnd = addDays(rangeStart, 30); }

  // Lookup adatok
  const { data: resources } = useQuery({
    queryKey: ["res-list", orgId], enabled: !!orgId,
    queryFn: async () => (await supabase.from("resources").select("id, name, type").eq("organization_id", orgId!).eq("active", true)).data ?? [],
  });
  const { data: staffList } = useQuery({
    queryKey: ["staff-list", orgId], enabled: !!orgId,
    queryFn: async () => (await supabase.from("staff_profiles").select("id, display_name, user_id, working_hours_json, availability_windows_json").eq("organization_id", orgId!).eq("active", true)).data ?? [],
  });
  const { data: servicesList } = useQuery({
    queryKey: ["svc-list", orgId], enabled: !!orgId,
    queryFn: async () => (await supabase.from("services").select("id, name").eq("organization_id", orgId!).eq("active", true)).data ?? [],
  });
  const { data: serviceResources } = useQuery({
    queryKey: ["svc-res", orgId], enabled: !!orgId,
    queryFn: async () => (await supabase.from("service_resources").select("service_id, resource_id")).data ?? [],
  });

  // Saját staff profil (alkalmazott nézethez) — admin/owner staff-szemszögű előnézet felülírja.
  const myStaffProfileId = useMemo(() => {
    if (viewingStaffProfileId) return viewingStaffProfileId;
    if (!isStaffView || !user) return null;
    return staffList?.find((s: any) => s.user_id === user.id)?.id ?? null;
  }, [isStaffView, user, staffList, viewingStaffProfileId]);

  // Foglalások
  const { data: bookings } = useQuery({
    queryKey: ["cal-bookings", orgId, view, rangeStart.toISOString(), isStaffView, myStaffProfileId],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase.from("bookings")
        .select("*, services(name), customers(full_name), staff_profiles(display_name, user_id)")
        .eq("organization_id", orgId!)
        .gte("start_at", rangeStart.toISOString())
        .lt("start_at", rangeEnd.toISOString())
        .order("start_at");
      if (isStaffView && myStaffProfileId) q = q.eq("staff_profile_id", myStaffProfileId);
      return (await q).data ?? [];
    },
  });

  // Erőforrás-hozzárendelések (vizualizációhoz)
  const { data: assignments } = useQuery({
    queryKey: ["sra", orgId, isStaffView, myStaffProfileId],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase.from("staff_resource_assignments")
        .select("*, resources(name, type), staff_profiles(display_name)")
        .eq("organization_id", orgId!).eq("active", true);
      if (isStaffView && myStaffProfileId) q = q.eq("staff_profile_id", myStaffProfileId);
      return (await q).data ?? [];
    },
  });

  // Szűrt foglalások
  const filtered = useMemo(() => {
    if (!bookings) return [];
    const svcResMap = new Map<string, string[]>();
    (serviceResources ?? []).forEach((sr: any) => {
      const arr = svcResMap.get(sr.service_id) ?? [];
      arr.push(sr.resource_id);
      svcResMap.set(sr.service_id, arr);
    });
    const resTypeMap = new Map<string, string>();
    (resources ?? []).forEach((r: any) => resTypeMap.set(r.id, r.type));
    return bookings.filter((b: any) => {
      if (filterStaffIds.length > 0 && !filterStaffIds.includes(b.staff_profile_id)) return false;
      if (filterServiceIds.length > 0 && !filterServiceIds.includes(b.service_id)) return false;
      if (filterResourceIds.length > 0 || filterResourceTypes.length > 0) {
        const used = new Set<string>();
        if (b.resource_id) used.add(b.resource_id);
        (svcResMap.get(b.service_id) ?? []).forEach((r) => used.add(r));
        const usedTypes = new Set<string>();
        used.forEach((rid) => { const t = resTypeMap.get(rid); if (t) usedTypes.add(t); });
        const matchById = filterResourceIds.length === 0 || filterResourceIds.some((rid) => used.has(rid));
        const matchByType = filterResourceTypes.length === 0 || filterResourceTypes.some((t) => usedTypes.has(t));
        if (!matchById || !matchByType) return false;
      }
      return true;
    });
  }, [bookings, filterStaffIds, filterServiceIds, filterResourceIds, filterResourceTypes, resources, serviceResources]);

  const filteredAssignments = useMemo(() => {
    if (!assignments) return [];
    return assignments.filter((a: any) => {
      if (filterStaffIds.length > 0 && !filterStaffIds.includes(a.staff_profile_id)) return false;
      if (filterResourceIds.length > 0 && !filterResourceIds.includes(a.resource_id)) return false;
      if (filterResourceTypes.length > 0 && !filterResourceTypes.includes(a.resources?.type)) return false;
      return true;
    });
  }, [assignments, filterStaffIds, filterResourceIds, filterResourceTypes]);

  // Kattintási dialog
  const [selected, setSelected] = useState<any | null>(null);

  if (!orgId) return <p className="text-muted-foreground">Először rendelj magadhoz egy szervezetet az Áttekintés oldalon.</p>;

  const go = (dir: -1 | 1) => {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else if (view === "month") setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
    else setAnchor(addDays(anchor, 30 * dir));
  };

  const title = (() => {
    if (view === "day") return anchor.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    if (view === "week") {
      const end = addDays(rangeStart, 6);
      return `${rangeStart.toLocaleDateString("hu-HU", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("hu-HU", { month: "short", day: "numeric", year: "numeric" })}`;
    }
    if (view === "month") return anchor.toLocaleDateString("hu-HU", { year: "numeric", month: "long" });
    return `Következő 30 nap (${rangeStart.toLocaleDateString("hu-HU")})`;
  })();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-3xl font-bold">Naptár</h1>
        <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
          <TabsList>
            <TabsTrigger value="day">Nap</TabsTrigger>
            <TabsTrigger value="week">Hét</TabsTrigger>
            <TabsTrigger value="month">Hónap</TabsTrigger>
            <TabsTrigger value="agenda">Lista</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isOwnerView && (
        <Card className="p-3 mb-4 flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium mr-2">Szűrők:</span>
          <MultiPicker
            label="Erőforrások"
            options={[
              ...RESOURCE_TYPES.map((t) => ({ id: `type:${t}`, name: `Típus: ${t}`, group: "Típus" })),
              ...((resources ?? []).map((r: any) => ({ id: r.id, name: r.name, group: r.type }))),
            ]}
            selected={[...filterResourceTypes.map((t) => `type:${t}`), ...filterResourceIds]}
            onChange={(ids) => {
              setFilterResourceTypes(ids.filter((i) => i.startsWith("type:")).map((i) => i.slice(5)));
              setFilterResourceIds(ids.filter((i) => !i.startsWith("type:")));
            }}
          />
          <MultiPicker
            label="Alkalmazottak"
            options={(staffList ?? []).map((s: any) => ({ id: s.id, name: s.display_name }))}
            selected={filterStaffIds}
            onChange={setFilterStaffIds}
          />
          <MultiPicker
            label="Szolgáltatások"
            options={(servicesList ?? []).map((s: any) => ({ id: s.id, name: s.name }))}
            selected={filterServiceIds}
            onChange={setFilterServiceIds}
          />
          {hasAnyFilter && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              <X className="w-3.5 h-3.5 mr-1" /> Szűrők törlése
            </Button>
          )}
        </Card>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => go(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={() => setAnchor(startOfDay(new Date()))}>Ma</Button>
          <Button variant="outline" size="icon" onClick={() => go(1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>

      {view === "day" && <DayView bookings={filtered} assignments={filteredAssignments} day={rangeStart} onSelect={setSelected} staffList={staffList ?? []} filterStaffIds={filterStaffIds} />}
      {view === "week" && <WeekView bookings={filtered} assignments={filteredAssignments} weekStart={rangeStart} onSelect={setSelected} staffList={staffList ?? []} filterStaffIds={filterStaffIds} />}
      {view === "month" && <MonthView bookings={filtered} monthStart={rangeStart} onSelect={setSelected} />}
      {view === "agenda" && <AgendaView bookings={filtered} onSelect={setSelected} />}

      <BookingDialog
        booking={selected}
        onClose={() => setSelected(null)}
        canEdit={!readOnly && (isOwnerView || (isStaffView && !!myStaffProfileId && selected?.staff_profile_id === myStaffProfileId))}
        isOwner={!readOnly && isOwnerView}
      />
    </div>
  );
}

function MultiPicker({ label, options, selected, onChange }: {
  label: string;
  options: { id: string; name: string; group?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const grouped = useMemo(() => {
    const m = new Map<string, typeof options>();
    options.forEach((o) => {
      const k = o.group ?? "";
      const arr = m.get(k) ?? [];
      arr.push(o); m.set(k, arr);
    });
    return Array.from(m.entries());
  }, [options]);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {label}{selected.length > 0 && <Badge variant="secondary" className="ml-2">{selected.length}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 max-h-80 overflow-auto">
        {options.length === 0 && <div className="text-xs text-muted-foreground p-2">Nincs választható elem.</div>}
        {grouped.map(([g, items]) => (
          <div key={g} className="mb-2">
            {g && <div className="text-xs uppercase text-muted-foreground px-1 mb-1">{g}</div>}
            {items.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm px-1 py-1 hover:bg-accent rounded cursor-pointer">
                <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                <span className="truncate">{o.name}</span>
              </label>
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function BookingItem({ b, onSelect }: { b: any; onSelect?: (b: any) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(b)}
      className="w-full text-left text-xs bg-primary/10 hover:bg-primary/20 rounded p-1.5 transition-colors"
    >
      <div className="font-medium">{new Date(b.start_at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}</div>
      <div className="truncate">{b.services?.name}</div>
      <div className="truncate text-muted-foreground">{b.customers?.full_name}</div>
      {b.staff_profiles?.display_name && <div className="truncate text-[10px] text-muted-foreground">{b.staff_profiles.display_name}</div>}
    </button>
  );
}

function AssignmentChip({ a }: { a: any }) {
  return (
    <div className="text-[10px] bg-muted/60 border border-dashed border-muted-foreground/40 rounded px-1.5 py-0.5">
      🔒 {a.resources?.name} — {a.staff_profiles?.display_name}
      <span className="ml-1 text-muted-foreground">
        {a.kind === "always" ? "(állandó)" : a.kind === "weekly" ? "(heti)" : "(időablak)"}
      </span>
    </div>
  );
}

const DAY_KEYS = ["sun","mon","tue","wed","thu","fri","sat"] as const;

/** Egy adott napra meghatározza az "elérhető" időtartományokat (perc 0–1440), a kiszűrt
 *  alkalmazottak heti munkaidejének UNIÓjaként. Ha nincs szűrő, minden aktív alkalmazott számít. */
function computeOpenRanges(day: Date, staffList: any[], filterStaffIds: string[]): Array<[number, number]> {
  const dk = DAY_KEYS[day.getDay()];
  const candidates = filterStaffIds.length > 0
    ? staffList.filter((s) => filterStaffIds.includes(s.id))
    : staffList;
  const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const ranges: Array<[number, number]> = [];
  for (const s of candidates) {
    const pat = s.working_hours_json ?? {};
    const v = pat[dk];
    if (!v) continue;
    const list: [string, string][] = Array.isArray(v) && typeof v[0] === "string" ? [[v[0], v[1]]] : (Array.isArray(v) ? v : []);
    const staffRanges: Array<[number, number]> = list.map(([hs, he]) => {
      const [sh, sm] = hs.split(":").map(Number);
      const [eh, em] = he.split(":").map(Number);
      return [sh * 60 + (sm || 0), eh * 60 + (em || 0)] as [number, number];
    });
    // Rendelkezésre állási ablakok metszete erre a napra (ha van bármilyen ablak)
    const windowsRaw: any[] = Array.isArray(s.availability_windows_json) ? s.availability_windows_json : [];
    const validWindows = windowsRaw.filter((w) => w && typeof w.start === "string" && typeof w.end === "string");
    let effective = staffRanges;
    if (validWindows.length > 0) {
      const windowsOnDay: Array<[number, number]> = [];
      for (const w of validWindows) {
        const ws = new Date(w.start), we = new Date(w.end);
        if (we <= dayStart || ws >= dayEnd) continue;
        const sMin = ws < dayStart ? 0 : ws.getHours() * 60 + ws.getMinutes();
        const eMin = we > dayEnd ? 24 * 60 : we.getHours() * 60 + we.getMinutes();
        if (eMin > sMin) windowsOnDay.push([sMin, eMin]);
      }
      // metszet: csak azok a percek, amelyek mind munkaidőben, mind az ablakok valamelyikében benne vannak
      effective = [];
      for (const [rs, re] of staffRanges) {
        for (const [ws, we] of windowsOnDay) {
          const a = Math.max(rs, ws), b = Math.min(re, we);
          if (b > a) effective.push([a, b]);
        }
      }
    }
    ranges.push(...effective);
  }
  // unió
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

function isHourOpen(hour: number, openRanges: Array<[number, number]>): boolean {
  const m = hour * 60;
  return openRanges.some(([s, e]) => m < e && m + 60 > s);
}

function DayView({ bookings, assignments, day, onSelect, staffList, filterStaffIds }: { bookings: any[]; assignments: any[]; day: Date; onSelect: (b: any) => void; staffList: any[]; filterStaffIds: string[] }) {
  const openRanges = useMemo(() => computeOpenRanges(day, staffList, filterStaffIds), [day, staffList, filterStaffIds]);
  const hours = useMemo(() => {
    if (openRanges.length === 0) return Array.from({ length: 16 }, (_, i) => i + 7);
    const minH = Math.max(0, Math.floor(Math.min(...openRanges.map((r) => r[0])) / 60));
    const maxH = Math.min(24, Math.ceil(Math.max(...openRanges.map((r) => r[1])) / 60));
    const lo = Math.max(0, minH - 1);
    const hi = Math.min(24, Math.max(maxH + 1, lo + 2));
    return Array.from({ length: hi - lo }, (_, i) => lo + i);
  }, [openRanges]);
  const dayEnd = addDays(day, 1);

  const dayAssigns = assignments.filter((a) => {
    if (a.kind === "always") return true;
    if (a.kind === "window") return new Date(a.starts_at) < dayEnd && new Date(a.ends_at) > day;
    if (a.kind === "weekly") {
      const dk = DAY_KEYS[day.getDay()];
      return !!a.weekly_pattern_json?.[dk]?.length;
    }
    return false;
  });
  return (
    <Card className="p-4">
      <div className="text-sm font-semibold mb-3">{day.toLocaleDateString("hu-HU", { weekday: "long", month: "long", day: "numeric" })}</div>
      {dayAssigns.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3 pb-3 border-b">
          {dayAssigns.map((a) => <AssignmentChip key={a.id} a={a} />)}
        </div>
      )}
      <div className="divide-y">
        {hours.map((h) => {
          const items = bookings.filter((b) => new Date(b.start_at).getHours() === h);
          const open = isHourOpen(h, openRanges);
          return (
            <div key={h} className={`flex gap-3 py-2 ${!open ? "bg-muted/40" : ""}`}>
              <div className="w-14 text-xs text-muted-foreground pt-1">{String(h).padStart(2, "0")}:00</div>
              <div className="flex-1 space-y-1">
                {items.length > 0 ? items.map((b) => <BookingItem key={b.id} b={b} onSelect={onSelect} />)
                  : open ? <div className="text-xs text-emerald-700/70 dark:text-emerald-400/70">Szabad</div>
                  : <div className="text-xs text-muted-foreground italic">Nem foglalható</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-3 border-t flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-primary/20 inline-block" /> Foglalás</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-background border inline-block" /> Szabad</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-muted inline-block" /> Nem foglalható</span>
      </div>
    </Card>
  );
}

function WeekView({ bookings, assignments, weekStart, onSelect, staffList, filterStaffIds }: { bookings: any[]; assignments: any[]; weekStart: Date; onSelect: (b: any) => void; staffList: any[]; filterStaffIds: string[] }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayOpenRanges = useMemo(
    () => days.map((d) => computeOpenRanges(d, staffList, filterStaffIds)),
    [weekStart.toISOString(), staffList, filterStaffIds]
  );
  const hours = useMemo(() => {
    const all = dayOpenRanges.flat();
    if (all.length === 0) return Array.from({ length: 16 }, (_, i) => i + 7);
    const minH = Math.max(0, Math.floor(Math.min(...all.map((r) => r[0])) / 60));
    const maxH = Math.min(24, Math.ceil(Math.max(...all.map((r) => r[1])) / 60));
    const lo = Math.max(0, minH - 1);
    const hi = Math.min(24, Math.max(maxH + 1, lo + 2));
    return Array.from({ length: hi - lo }, (_, i) => lo + i);
  }, [dayOpenRanges]);

  const today = new Date().toDateString();
  return (
    <Card className="p-2 overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-[56px_repeat(7,1fr)] gap-0.5 mb-1">
          <div />
          {days.map((day) => {
            const dayEnd = addDays(day, 1);
            const dayAssigns = assignments.filter((a) => {
              if (a.kind === "always") return true;
              if (a.kind === "window") return new Date(a.starts_at) < dayEnd && new Date(a.ends_at) > day;
              if (a.kind === "weekly") {
                const dk = DAY_KEYS[day.getDay()];
                return !!a.weekly_pattern_json?.[dk]?.length;
              }
              return false;
            });
            const isToday = day.toDateString() === today;
            return (
              <div key={day.toISOString()} className={`px-1 py-1 text-center border-b ${isToday ? "bg-primary/10" : ""}`}>
                <div className="text-[10px] uppercase text-muted-foreground">{day.toLocaleDateString("hu-HU", { weekday: "short" })}</div>
                <div className="text-sm font-semibold">{day.getDate()}</div>
                {dayAssigns.length > 0 && (
                  <div className="text-[9px] text-muted-foreground mt-0.5">🔒 {dayAssigns.length}</div>
                )}
              </div>
            );
          })}
        </div>
        {hours.map((h) => (
          <div key={h} className="grid grid-cols-[56px_repeat(7,1fr)] gap-0.5">
            <div className="text-[10px] text-muted-foreground text-right pr-2 pt-1">{String(h).padStart(2, "0")}:00</div>
            {days.map((day, di) => {
              const open = isHourOpen(h, dayOpenRanges[di]);
              const items = bookings.filter((b) => {
                const d = new Date(b.start_at);
                return d.toDateString() === day.toDateString() && d.getHours() === h;
              });
              return (
                <div
                  key={day.toISOString() + h}
                  className={`min-h-[44px] border rounded p-0.5 ${!open ? "bg-muted/50 border-dashed" : "bg-background"}`}
                  title={open ? "Foglalható időzóna" : "Nem foglalható időzóna"}
                >
                  {items.length === 0
                    ? !open && <div className="text-[9px] text-muted-foreground/60 text-center pt-2">×</div>
                    : items.map((b) => (
                      <button key={b.id} type="button" onClick={() => onSelect(b)}
                        className="block w-full text-left text-[10px] bg-primary/15 hover:bg-primary/25 rounded px-1 py-0.5 truncate mb-0.5">
                        {new Date(b.start_at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })} {b.services?.name}
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        ))}
        <div className="mt-3 pt-2 border-t flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-primary/20 inline-block" /> Foglalás</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-background border inline-block" /> Foglalható (szabad)</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-muted/50 border border-dashed inline-block" /> Nem foglalható</span>
        </div>
      </div>
    </Card>
  );
}

function MonthView({ bookings, monthStart, onSelect }: { bookings: any[]; monthStart: Date; onSelect: (b: any) => void }) {
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const monthIdx = monthStart.getMonth();
  const weekdays = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];
  return (
    <Card className="p-3">
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekdays.map((w) => <div key={w} className="text-xs text-muted-foreground text-center font-medium">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day) => {
          const isCurrentMonth = day.getMonth() === monthIdx;
          const dayBookings = bookings.filter((b) => new Date(b.start_at).toDateString() === day.toDateString());
          return (
            <div key={day.toISOString()} className={`min-h-[80px] rounded border p-1.5 ${isCurrentMonth ? "bg-card" : "bg-muted/30 text-muted-foreground"}`}>
              <div className="text-xs font-medium mb-1">{day.getDate()}</div>
              <div className="space-y-0.5">
                {dayBookings.slice(0, 3).map((b) => (
                  <button key={b.id} type="button" onClick={() => onSelect(b)} className="block w-full text-left text-[10px] bg-primary/10 hover:bg-primary/20 rounded px-1 py-0.5 truncate">
                    {new Date(b.start_at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })} {b.services?.name}
                  </button>
                ))}
                {dayBookings.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayBookings.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AgendaView({ bookings, onSelect }: { bookings: any[]; onSelect: (b: any) => void }) {
  if (bookings.length === 0) return <Card className="p-6 text-sm text-muted-foreground">Nincs foglalás ebben az időszakban.</Card>;
  const groups = bookings.reduce<Record<string, any[]>>((acc, b) => {
    const k = new Date(b.start_at).toDateString();
    (acc[k] = acc[k] || []).push(b);
    return acc;
  }, {});
  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([k, items]) => (
        <Card key={k} className="p-4">
          <div className="text-sm font-semibold mb-2">{new Date(k).toLocaleDateString("hu-HU", { weekday: "long", month: "long", day: "numeric" })}</div>
          <div className="space-y-2">
            {items.map((b) => (
              <button key={b.id} type="button" onClick={() => onSelect(b)} className="w-full text-left flex items-start gap-3 text-sm border-l-2 border-primary pl-3 hover:bg-accent rounded-r py-1">
                <div className="w-16 text-muted-foreground">{new Date(b.start_at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}</div>
                <div className="flex-1">
                  <div className="font-medium">{b.services?.name}</div>
                  <div className="text-muted-foreground text-xs">{b.customers?.full_name} {b.staff_profiles?.display_name ? `• ${b.staff_profiles.display_name}` : ""}</div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function BookingDialog({ booking, onClose, canEdit, isOwner }: { booking: any | null; onClose: () => void; canEdit: boolean; isOwner: boolean }) {
  const qc = useQueryClient();
  const update = useServerFn(updateBookingTime);
  const cancel = useServerFn(cancelBookingAsStaff);
  const saveNote = useServerFn(updateBookingNote);
  const savePay = useServerFn(updateBookingPaymentStatus);
  const [newStart, setNewStart] = useState("");
  const [note, setNote] = useState<string>(booking?.note ?? "");
  const [noteVisible, setNoteVisible] = useState<boolean>(!!booking?.note_visible_to_customer);
  const [payStatus, setPayStatus] = useState<string>(booking?.payment_status ?? "none");

  // Sync local state when a different booking is opened
  const bookingId = booking?.id;
  useMemo(() => {
    setNote(booking?.note ?? "");
    setNoteVisible(!!booking?.note_visible_to_customer);
    setPayStatus(booking?.payment_status ?? "none");
    setNewStart("");
  }, [bookingId]);

  const updMut = useMutation({
    mutationFn: () => update({ data: { bookingId: booking.id, startAt: new Date(newStart).toISOString() } }),
    onSuccess: () => { toast.success("Időpont módosítva — ügyfél értesítve"); qc.invalidateQueries({ queryKey: ["cal-bookings"] }); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const canMut = useMutation({
    mutationFn: (reason: string) => cancel({ data: { bookingId: booking.id, reason } }),
    onSuccess: () => { toast.success("Foglalás törölve — ügyfél értesítve"); qc.invalidateQueries({ queryKey: ["cal-bookings"] }); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const noteMut = useMutation({
    mutationFn: () => saveNote({ data: { bookingId: booking.id, note: note || null, noteVisibleToCustomer: noteVisible } }),
    onSuccess: () => { toast.success("Megjegyzés mentve"); qc.invalidateQueries({ queryKey: ["cal-bookings"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const payMut = useMutation({
    mutationFn: (s: "none" | "mock_paid" | "paid") => savePay({ data: { bookingId: booking.id, paymentStatus: s } }),
    onSuccess: () => { toast.success("Fizetési státusz frissítve"); qc.invalidateQueries({ queryKey: ["cal-bookings"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!booking) return null;
  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{booking.services?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">Ügyfél:</span> {booking.customers?.full_name}</div>
          <div><span className="text-muted-foreground">Munkatárs:</span> {booking.staff_profiles?.display_name ?? "—"}</div>
          <div><span className="text-muted-foreground">Időpont:</span> {new Date(booking.start_at).toLocaleString("hu-HU")} – {new Date(booking.end_at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}</div>
          <div><span className="text-muted-foreground">Állapot:</span> <Badge>{booking.status}</Badge></div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Fizetés:</span>
            {isOwner ? (
              <Select value={payStatus} onValueChange={(v) => { setPayStatus(v); payMut.mutate(v as any); }}>
                <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nincsen fizetve</SelectItem>
                  <SelectItem value="mock_paid">Előleg fizetve</SelectItem>
                  <SelectItem value="paid">Kifizetve</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline">{booking.payment_status}</Badge>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="space-y-3 pt-3 border-t">
            <div>
              <Label className="text-sm">Új időpont</Label>
              <div className="flex gap-2 mt-1">
                <Input type="datetime-local" value={newStart || toLocalInput(booking.start_at)} onChange={(e) => setNewStart(e.target.value)} />
                <Button onClick={() => updMut.mutate()} disabled={updMut.isPending}>Áthelyezés</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Megjegyzés</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Belső jegyzet a foglaláshoz…"
                rows={3}
              />
              <div className="flex items-center gap-2">
                <Checkbox
                  id="note-visible"
                  checked={noteVisible}
                  onCheckedChange={(v) => setNoteVisible(!!v)}
                />
                <Label htmlFor="note-visible" className="text-sm font-normal cursor-pointer">
                  A vendég láthatja a megjegyzést
                </Label>
              </div>
              <Button size="sm" onClick={() => noteMut.mutate()} disabled={noteMut.isPending}>
                Megjegyzés mentése
              </Button>
            </div>
            <CancelBox onCancel={(reason) => canMut.mutate(reason)} pending={canMut.isPending} />
          </div>
        )}
        {!canEdit && booking.note && booking.note_visible_to_customer && (
          <div className="pt-3 border-t">
            <Label className="text-sm text-muted-foreground">Megjegyzés</Label>
            <p className="text-sm mt-1 whitespace-pre-wrap">{booking.note}</p>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Bezárás</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function CancelBox({ onCancel, pending }: { onCancel: (reason: string) => void; pending: boolean }) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <Button variant="destructive" onClick={() => setConfirming(true)}>Foglalás törlése</Button>;
  }
  return (
    <div className="space-y-2 rounded border border-destructive/30 p-3">
      <Label className="text-sm">Indoklás (opcionális, az ügyfélnek megy)</Label>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="pl. munkatárs betegség" />
      <div className="flex gap-2">
        <Button variant="destructive" onClick={() => onCancel(reason)} disabled={pending}>Megerősítem a törlést</Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>Mégsem</Button>
      </div>
    </div>
  );
}
