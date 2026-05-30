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
import { updateBookingTime, cancelBookingAsStaff, updateBookingNote } from "@/lib/bookings.functions";
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
    queryFn: async () => (await supabase.from("staff_profiles").select("id, display_name, user_id").eq("organization_id", orgId!).eq("active", true)).data ?? [],
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

      {view === "day" && <DayView bookings={filtered} assignments={filteredAssignments} day={rangeStart} onSelect={setSelected} />}
      {view === "week" && <WeekView bookings={filtered} assignments={filteredAssignments} weekStart={rangeStart} onSelect={setSelected} />}
      {view === "month" && <MonthView bookings={filtered} monthStart={rangeStart} onSelect={setSelected} />}
      {view === "agenda" && <AgendaView bookings={filtered} onSelect={setSelected} />}

      <BookingDialog
        booking={selected}
        onClose={() => setSelected(null)}
        canEdit={!readOnly && (isOwnerView || (isStaffView && !!myStaffProfileId && selected?.staff_profile_id === myStaffProfileId))}
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

function DayView({ bookings, assignments, day, onSelect }: { bookings: any[]; assignments: any[]; day: Date; onSelect: (b: any) => void }) {
  const hours = Array.from({ length: 14 }, (_, i) => i + 7);
  const dayEnd = addDays(day, 1);
  const dayAssigns = assignments.filter((a) => {
    if (a.kind === "always") return true;
    if (a.kind === "window") return new Date(a.starts_at) < dayEnd && new Date(a.ends_at) > day;
    if (a.kind === "weekly") {
      const dk = ["sun","mon","tue","wed","thu","fri","sat"][day.getDay()];
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
          return (
            <div key={h} className="flex gap-3 py-2">
              <div className="w-14 text-xs text-muted-foreground pt-1">{String(h).padStart(2, "0")}:00</div>
              <div className="flex-1 space-y-1">
                {items.length === 0 ? <div className="text-xs text-muted-foreground">—</div> : items.map((b) => <BookingItem key={b.id} b={b} onSelect={onSelect} />)}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekView({ bookings, assignments, weekStart, onSelect }: { bookings: any[]; assignments: any[]; weekStart: Date; onSelect: (b: any) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
      {days.map((day) => {
        const dayEnd = addDays(day, 1);
        const dayBookings = bookings.filter((b) => new Date(b.start_at).toDateString() === day.toDateString());
        const dayAssigns = assignments.filter((a) => {
          if (a.kind === "always") return true;
          if (a.kind === "window") return new Date(a.starts_at) < dayEnd && new Date(a.ends_at) > day;
          if (a.kind === "weekly") {
            const dk = ["sun","mon","tue","wed","thu","fri","sat"][day.getDay()];
            return !!a.weekly_pattern_json?.[dk]?.length;
          }
          return false;
        });
        return (
          <Card key={day.toISOString()} className="p-3 min-h-[200px]">
            <div className="text-xs uppercase text-muted-foreground">{day.toLocaleDateString("hu-HU", { weekday: "short" })}</div>
            <div className="font-semibold mb-2">{day.getDate()}</div>
            {dayAssigns.length > 0 && (
              <div className="space-y-0.5 mb-2 pb-2 border-b">
                {dayAssigns.map((a) => <AssignmentChip key={a.id} a={a} />)}
              </div>
            )}
            <div className="space-y-1">
              {dayBookings.map((b) => <BookingItem key={b.id} b={b} onSelect={onSelect} />)}
              {dayBookings.length === 0 && <div className="text-xs text-muted-foreground">—</div>}
            </div>
          </Card>
        );
      })}
    </div>
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

function BookingDialog({ booking, onClose, canEdit }: { booking: any | null; onClose: () => void; canEdit: boolean }) {
  const qc = useQueryClient();
  const update = useServerFn(updateBookingTime);
  const cancel = useServerFn(cancelBookingAsStaff);
  const saveNote = useServerFn(updateBookingNote);
  const [newStart, setNewStart] = useState("");
  const [note, setNote] = useState<string>(booking?.note ?? "");
  const [noteVisible, setNoteVisible] = useState<boolean>(!!booking?.note_visible_to_customer);

  // Sync local state when a different booking is opened
  const bookingId = booking?.id;
  useMemo(() => {
    setNote(booking?.note ?? "");
    setNoteVisible(!!booking?.note_visible_to_customer);
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
