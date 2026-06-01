import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, Filter, X, Plus } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { updateBookingTime, cancelBookingAsStaff, updateBookingNote, updateBookingPaymentStatus } from "@/lib/bookings.functions";
import { createInternalBooking, checkInternalBookingConflicts } from "@/lib/internal-bookings.functions";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { resolveDayPattern } from "@/lib/timezone";
import { PhoneInput } from "@/components/PhoneInput";
import { ConflictDialog, parseConflictsFromError, type ConflictItem } from "@/components/ConflictDialog";

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

const LS_PREFIX = "cal.v2.";
function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
}
function lsSet(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch { /* noop */ }
}

function CalendarPage() {
  const { ownedOrgIds, readOnly, effectiveRole, user, viewingStaffProfileId } = useAuth();
  const orgId = ownedOrgIds[0];
  const qc = useQueryClient();
  const [view, setView] = useState<ViewMode>(() => lsGet<ViewMode>("view", "week"));
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  useEffect(() => { lsSet("view", view); }, [view]);

  // Szűrők (csak owner). null = még nem inicializált → alapból minden be lesz pipálva.
  const isOwnerView = (effectiveRole === "owner" || effectiveRole === "platform_admin") && !viewingStaffProfileId;
  const isStaffView = effectiveRole === "staff" || !!viewingStaffProfileId;
  const [filterResourceIds, setFilterResourceIds] = useState<string[] | null>(() => lsGet<string[] | null>("resIds", null));
  const [filterResourceTypes, setFilterResourceTypes] = useState<string[] | null>(() => lsGet<string[] | null>("resTypes", null));
  const [filterStaffIds, setFilterStaffIds] = useState<string[] | null>(() => lsGet<string[] | null>("staffIds", null));
  const [filterServiceIds, setFilterServiceIds] = useState<string[] | null>(() => lsGet<string[] | null>("svcIds", null));
  const [filterCustomerIds, setFilterCustomerIds] = useState<string[] | null>(() => lsGet<string[] | null>("custIds", null));
  useEffect(() => { lsSet("resIds", filterResourceIds); }, [filterResourceIds]);
  useEffect(() => { lsSet("resTypes", filterResourceTypes); }, [filterResourceTypes]);
  useEffect(() => { lsSet("staffIds", filterStaffIds); }, [filterStaffIds]);
  useEffect(() => { lsSet("svcIds", filterServiceIds); }, [filterServiceIds]);
  useEffect(() => { lsSet("custIds", filterCustomerIds); }, [filterCustomerIds]);

  // Range
  let rangeStart: Date, rangeEnd: Date;
  if (view === "day") { rangeStart = startOfDay(anchor); rangeEnd = addDays(rangeStart, 1); }
  else if (view === "week") { rangeStart = startOfWeek(anchor); rangeEnd = addDays(rangeStart, 7); }
  else if (view === "month") { rangeStart = startOfMonth(anchor); rangeEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1); }
  else { rangeStart = startOfDay(anchor); rangeEnd = addDays(rangeStart, 30); }

  // Lookup adatok
  const { data: resources } = useQuery({
    queryKey: ["res-list", orgId], enabled: !!orgId,
    queryFn: async () => (await supabase.from("resources").select("id, name, type, capacity").eq("organization_id", orgId!).eq("active", true)).data ?? [],
  });
  const { data: staffList } = useQuery({
    queryKey: ["staff-list", orgId], enabled: !!orgId,
    queryFn: async () => (await supabase.from("staff_profiles").select("id, display_name, user_id, working_hours_json, availability_windows_json").eq("organization_id", orgId!).eq("active", true)).data ?? [],
  });
  const { data: servicesList } = useQuery({
    queryKey: ["svc-list", orgId], enabled: !!orgId,
    queryFn: async () => (await supabase.from("services").select("id, name").eq("organization_id", orgId!).eq("active", true)).data ?? [],
  });
  const { data: customersList } = useQuery({
    queryKey: ["cust-list", orgId], enabled: !!orgId,
    queryFn: async () => (await supabase.from("customers").select("id, full_name").eq("organization_id", orgId!).order("full_name")).data ?? [],
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
        .select("*, services(name, tags), customers(full_name), staff_profiles(display_name, user_id)")
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

  // "Effektív" szűrőhalmazok: ha még null (sosem volt érintve), alapból minden be van pipálva.
  const allStaffIds = useMemo(() => (staffList ?? []).map((s: any) => s.id), [staffList]);
  const allServiceIds = useMemo(() => (servicesList ?? []).map((s: any) => s.id), [servicesList]);
  const allCustomerIds = useMemo(() => (customersList ?? []).map((c: any) => c.id), [customersList]);
  const allResourceIds = useMemo(() => (resources ?? []).map((r: any) => r.id), [resources]);
  const allResourceTypes = useMemo(() => [...RESOURCE_TYPES], []);
  const effStaffIds = filterStaffIds ?? allStaffIds;
  const effServiceIds = filterServiceIds ?? allServiceIds;
  const effCustomerIds = filterCustomerIds ?? allCustomerIds;
  const effResourceIds = filterResourceIds ?? allResourceIds;
  const effResourceTypes = filterResourceTypes ?? allResourceTypes;

  const hasAnyFilter =
    (filterStaffIds !== null && filterStaffIds.length !== allStaffIds.length) ||
    (filterServiceIds !== null && filterServiceIds.length !== allServiceIds.length) ||
    (filterCustomerIds !== null && filterCustomerIds.length !== allCustomerIds.length) ||
    (filterResourceIds !== null && filterResourceIds.length !== allResourceIds.length) ||
    (filterResourceTypes !== null && filterResourceTypes.length !== allResourceTypes.length);
  const clearFilters = () => {
    setFilterResourceIds(null); setFilterResourceTypes(null);
    setFilterStaffIds(null); setFilterServiceIds(null); setFilterCustomerIds(null);
  };

  // Szűrt foglalások — minden szűrő include-check; ha üres, semmi nem jelenik meg.
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
      if (b.staff_profile_id && !effStaffIds.includes(b.staff_profile_id)) return false;
      if (b.service_id && !effServiceIds.includes(b.service_id)) return false;
      if (b.customer_id && !effCustomerIds.includes(b.customer_id)) return false;
      const used = new Set<string>();
      if (b.resource_id) used.add(b.resource_id);
      (svcResMap.get(b.service_id) ?? []).forEach((r) => used.add(r));
      // Ha a foglaláshoz egyáltalán nem tartozik erőforrás, akkor az erőforrás-szűrőtől függetlenül átmegy.
      if (used.size > 0) {
        const usedTypes = new Set<string>();
        used.forEach((rid) => { const t = resTypeMap.get(rid); if (t) usedTypes.add(t); });
        const matchById = [...used].some((rid) => effResourceIds.includes(rid));
        const matchByType = [...usedTypes].some((t) => effResourceTypes.includes(t));
        if (!matchById || !matchByType) return false;
      }
      return true;
    });
  }, [bookings, effStaffIds, effServiceIds, effCustomerIds, effResourceIds, effResourceTypes, resources, serviceResources]);

  const filteredAssignments = useMemo(() => {
    if (!assignments) return [];
    return assignments.filter((a: any) => {
      if (a.staff_profile_id && !effStaffIds.includes(a.staff_profile_id)) return false;
      if (a.resource_id && !effResourceIds.includes(a.resource_id)) return false;
      if (a.resources?.type && !effResourceTypes.includes(a.resources.type)) return false;
      return true;
    });
  }, [assignments, effStaffIds, effResourceIds, effResourceTypes]);

  // Kattintási dialog
  const [selected, setSelected] = useState<any | null>(null);
  const [newBookingOpen, setNewBookingOpen] = useState(false);

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
        <div className="flex items-center gap-2">
          {!readOnly && (isOwnerView || isStaffView) && (
            <Button size="sm" onClick={() => setNewBookingOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> Új foglalás
            </Button>
          )}
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="day">Nap</TabsTrigger>
              <TabsTrigger value="week">Hét</TabsTrigger>
              <TabsTrigger value="month">Hónap</TabsTrigger>
              <TabsTrigger value="agenda">Lista</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
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
            selected={[...effResourceTypes.map((t) => `type:${t}`), ...effResourceIds]}
            allOptionIds={[...allResourceTypes.map((t) => `type:${t}`), ...allResourceIds]}
            onChange={(ids) => {
              setFilterResourceTypes(ids.filter((i) => i.startsWith("type:")).map((i) => i.slice(5)));
              setFilterResourceIds(ids.filter((i) => !i.startsWith("type:")));
            }}
          />
          <MultiPicker
            label="Alkalmazottak"
            options={(staffList ?? []).map((s: any) => ({ id: s.id, name: s.display_name }))}
            selected={effStaffIds}
            allOptionIds={allStaffIds}
            onChange={setFilterStaffIds}
          />
          <MultiPicker
            label="Szolgáltatások"
            options={(servicesList ?? []).map((s: any) => ({ id: s.id, name: s.name }))}
            selected={effServiceIds}
            allOptionIds={allServiceIds}
            onChange={setFilterServiceIds}
            searchable
          />
          <MultiPicker
            label="Ügyfelek"
            options={(customersList ?? []).map((c: any) => ({ id: c.id, name: c.full_name ?? "(névtelen)" }))}
            selected={effCustomerIds}
            allOptionIds={allCustomerIds}
            onChange={setFilterCustomerIds}
            searchable
          />
          {hasAnyFilter && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              <X className="w-3.5 h-3.5 mr-1" /> Összes kijelölése
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

      {(() => {
        const emptyCats: string[] = [];
        if (isOwnerView) {
          if (effStaffIds.length === 0) emptyCats.push("munkatárs");
          if (effServiceIds.length === 0) emptyCats.push("szolgáltatás");
          if (effCustomerIds.length === 0) emptyCats.push("ügyfél");
          if (effResourceIds.length === 0 && allResourceIds.length > 0) emptyCats.push("erőforrás");
          if (effResourceTypes.length === 0) emptyCats.push("erőforrás-típus");
        }
        if (emptyCats.length > 0) {
          return (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Nincs megjeleníthető elem — minden {emptyCats.join(", ")} ki van véve a szűrőből.
              Pipálj be legalább egyet a szűrőkből a megjelenítéshez.
            </Card>
          );
        }
        const visibleResources = (resources ?? []).filter((r: any) => {
          if (r.type === "room" || r.type === "chair") {
            if (!effResourceIds.includes(r.id)) return false;
          }
          return true;
        });
        return (
          <>
            {view === "day" && <DayView bookings={filtered} allBookings={bookings ?? []} assignments={filteredAssignments} allAssignments={assignments ?? []} day={rangeStart} onSelect={setSelected} staffList={staffList ?? []} effStaffIds={effStaffIds} resources={visibleResources} serviceResources={serviceResources ?? []} showResourceCols={isOwnerView} />}
            {view === "week" && <WeekView bookings={filtered} allBookings={bookings ?? []} assignments={filteredAssignments} allAssignments={assignments ?? []} weekStart={rangeStart} onSelect={setSelected} staffList={staffList ?? []} effStaffIds={effStaffIds} resources={visibleResources} serviceResources={serviceResources ?? []} showResourceCols={isOwnerView} />}
            {view === "month" && <MonthView bookings={filtered} monthStart={rangeStart} onSelect={setSelected} />}
            {view === "agenda" && <AgendaView bookings={filtered} onSelect={setSelected} />}
          </>
        );
      })()}

      <BookingDialog
        booking={selected}
        onClose={() => setSelected(null)}
        canEdit={!readOnly && (isOwnerView || (isStaffView && !!myStaffProfileId && selected?.staff_profile_id === myStaffProfileId))}
        isOwner={!readOnly && isOwnerView}
      />

      <NewBookingDialog
        open={newBookingOpen}
        onClose={() => setNewBookingOpen(false)}
        orgId={orgId}
        services={servicesList ?? []}
        staffList={staffList ?? []}
        defaultStaffId={isStaffView ? myStaffProfileId : null}
        onCreated={() => qc.invalidateQueries({ queryKey: ["cal-bookings"] })}
      />
    </div>
  );
}

function MultiPicker({ label, options, selected, onChange, allOptionIds, searchable }: {
  label: string;
  options: { id: string; name: string; group?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Az "összes lehetséges" id-k; ehhez viszonyítva mutatjuk a részleges-állapotot. */
  allOptionIds?: string[];
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filteredOpts = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query, searchable]);
  const grouped = useMemo(() => {
    const m = new Map<string, typeof filteredOpts>();
    filteredOpts.forEach((o) => {
      const k = o.group ?? "";
      const arr = m.get(k) ?? [];
      arr.push(o); m.set(k, arr);
    });
    return Array.from(m.entries());
  }, [filteredOpts]);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const visibleIds = filteredOpts.map((o) => o.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const someVisibleSelected = visibleIds.some((id) => selected.includes(id));
  const headerCheckboxRef = (el: HTMLInputElement | null) => {
    if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
  };
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      onChange(selected.filter((id) => !visibleIds.includes(id)));
    } else {
      const merged = Array.from(new Set([...selected, ...visibleIds]));
      onChange(merged);
    }
  };
  const totalCount = allOptionIds ? allOptionIds.length : options.length;
  const isAllSelected = selected.length >= totalCount;
  const showBadge = !isAllSelected;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {label}{showBadge && <Badge variant="secondary" className="ml-2">{selected.length}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 max-h-80 overflow-auto">
        {searchable && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Keresés…"
            className="h-8 mb-2"
          />
        )}
        {filteredOpts.length > 0 && (
          <label className="flex items-center gap-2 text-sm px-1 py-1 mb-1 border-b cursor-pointer hover:bg-accent rounded">
            <input
              type="checkbox"
              ref={headerCheckboxRef}
              checked={allVisibleSelected}
              onChange={toggleAllVisible}
            />
            <span className="font-medium">
              {query.trim()
                ? `Mind kijelölése (${visibleIds.length})`
                : "Összes kijelölése"}
            </span>
          </label>
        )}
        {filteredOpts.length === 0 && <div className="text-xs text-muted-foreground p-2">Nincs találat.</div>}
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
  void dk;
  const candidates = filterStaffIds.length > 0
    ? staffList.filter((s) => filterStaffIds.includes(s.id))
    : staffList;
  const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const zonedDay = {
    year: dayStart.getFullYear(),
    month: dayStart.getMonth() + 1,
    day: dayStart.getDate(),
    weekday: dayStart.getDay(),
  };
  const ranges: Array<[number, number]> = [];
  for (const s of candidates) {
    const pat = s.working_hours_json ?? {};
    const v = resolveDayPattern(pat, zonedDay);
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

// ============= Új idő-rács alapú nap/hét nézet =============

const STAFF_PALETTE = ["#0ea5e9", "#a855f7", "#22c55e", "#f59e0b", "#ef4444", "#14b8a6", "#ec4899", "#6366f1", "#84cc16", "#f97316"];
const RESOURCE_PALETTE = ["#0369a1", "#7e22ce", "#15803d", "#b45309", "#b91c1c", "#0f766e", "#be185d", "#4338ca", "#4d7c0f", "#c2410c"];
const TAG_PALETTE = ["#fb923c", "#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#2dd4bf", "#fb7185", "#a3e635"];
const DEFAULT_BOOKING_COLOR = "#fb923c";
const PX_PER_MIN = 0.9;
const STAFF_BAND_WIDTH = 8;
const SUBCOL_HEADER_H = 36;

function hashIdx(s: string, mod: number) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}
function staffColor(id: string) { return STAFF_PALETTE[hashIdx(id, STAFF_PALETTE.length)]; }
function resourceColor(id: string) { return RESOURCE_PALETTE[hashIdx(id, RESOURCE_PALETTE.length)]; }
function tagColor(tag: string) { return TAG_PALETTE[hashIdx(tag, TAG_PALETTE.length)]; }
function bookingColor(tags?: string[] | null) {
  if (!tags || tags.length === 0) return DEFAULT_BOOKING_COLOR;
  return tagColor(tags[0]);
}
function fmtHM(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function minutesOfLocalDate(iso: string) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function rangesForStaffDay(s: any, day: Date): Array<[number, number]> {
  const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const zonedDay = { year: dayStart.getFullYear(), month: dayStart.getMonth() + 1, day: dayStart.getDate(), weekday: dayStart.getDay() };
  const v = resolveDayPattern(s.working_hours_json ?? {}, zonedDay);
  if (!v) return [];
  const list: [string, string][] = Array.isArray(v) && typeof v[0] === "string" ? [[v[0] as string, v[1] as string]] : (Array.isArray(v) ? (v as any) : []);
  let staffRanges: Array<[number, number]> = list.map(([hs, he]) => {
    const [sh, sm] = hs.split(":").map(Number);
    const [eh, em] = he.split(":").map(Number);
    return [sh * 60 + (sm || 0), eh * 60 + (em || 0)] as [number, number];
  });
  const windowsRaw: any[] = Array.isArray(s.availability_windows_json) ? s.availability_windows_json : [];
  const validWindows = windowsRaw.filter((w) => w && typeof w.start === "string" && typeof w.end === "string");
  if (validWindows.length > 0) {
    const windowsOnDay: Array<[number, number]> = [];
    for (const w of validWindows) {
      const ws = new Date(w.start), we = new Date(w.end);
      if (we <= dayStart || ws >= dayEnd) continue;
      const sMin = ws < dayStart ? 0 : ws.getHours() * 60 + ws.getMinutes();
      const eMin = we > dayEnd ? 24 * 60 : we.getHours() * 60 + we.getMinutes();
      if (eMin > sMin) windowsOnDay.push([sMin, eMin]);
    }
    const eff: Array<[number, number]> = [];
    for (const [rs, re] of staffRanges) for (const [ws, we] of windowsOnDay) {
      const a = Math.max(rs, ws), b = Math.min(re, we);
      if (b > a) eff.push([a, b]);
    }
    staffRanges = eff;
  }
  return staffRanges;
}

type Subcol = { key: string; resourceId: string | null; label: string; color: string };
function buildSubcols(resources: any[], showResourceCols: boolean, relevantResourceIds: Set<string> | null): Subcol[] {
  if (!showResourceCols) return [{ key: "_main", resourceId: null, label: "", color: "#94a3b8" }];
  let locs = resources.filter((r) => r.type === "room" || r.type === "chair");
  if (relevantResourceIds) {
    const filtered = locs.filter((r) => relevantResourceIds.has(r.id));
    if (filtered.length > 0) locs = filtered;
  }
  if (locs.length === 0) return [{ key: "_main", resourceId: null, label: "", color: "#94a3b8" }];
  const cols: Subcol[] = [];
  for (const r of locs) {
    const cap = Math.max(1, r.capacity ?? 1);
    const color = resourceColor(r.id);
    for (let i = 0; i < cap; i++) {
      cols.push({
        key: `${r.id}#${i}`,
        resourceId: r.id,
        label: cap > 1 ? `${r.name} ${i + 1}` : r.name,
        color,
      });
    }
  }
  return cols;
}

type Placed = { b: any; subcolIdx: number; topMin: number; durMin: number };
function placeBookings(bookings: any[], subcols: Subcol[], svcResMap: Map<string, string[]>): Placed[] {
  const sorted = [...bookings].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  const slotEndMin: number[] = subcols.map(() => -Infinity);
  const out: Placed[] = [];
  for (const b of sorted) {
    let rid: string | null = b.resource_id ?? null;
    if (!rid) {
      const arr = svcResMap.get(b.service_id) ?? [];
      if (arr.length === 1) rid = arr[0];
    }
    const startM = minutesOfLocalDate(b.start_at);
    const endM = minutesOfLocalDate(b.end_at);
    let chosenIdx = -1;
    const candIdx = subcols.map((c, i) => (rid && c.resourceId === rid ? i : -1)).filter((i) => i >= 0);
    if (candIdx.length > 0) {
      chosenIdx = candIdx.find((i) => slotEndMin[i] <= startM) ?? candIdx[0];
    } else {
      // Nincs preferált helyszín — első szabad oszlopba, különben a legkorábban felszabaduló oszlopba
      const free = subcols.findIndex((_, i) => slotEndMin[i] <= startM);
      if (free >= 0) chosenIdx = free;
      else {
        let best = 0;
        for (let i = 1; i < subcols.length; i++) if (slotEndMin[i] < slotEndMin[best]) best = i;
        chosenIdx = best;
      }
    }
    slotEndMin[chosenIdx] = endM;
    out.push({ b, subcolIdx: chosenIdx, topMin: startM, durMin: Math.max(15, endM - startM) });
  }
  return out;
}

function TimeGridDay({
  day, bookings, allBookings, assignments, allAssignments, staffList, effStaffIds, resources, serviceResources, showResourceCols, onSelect, startMin, endMin, compact,
}: {
  day: Date; bookings: any[]; allBookings: any[]; assignments: any[]; allAssignments: any[]; staffList: any[]; effStaffIds: string[]; resources: any[]; serviceResources: any[]; showResourceCols: boolean; onSelect: (b: any) => void; startMin: number; endMin: number; compact?: boolean;
}) {
  const svcResMap = useMemo(() => {
    const m = new Map<string, string[]>();
    const locIds = new Set(resources.filter((r) => r.type === "room" || r.type === "chair").map((r) => r.id));
    for (const sr of serviceResources) {
      if (!locIds.has(sr.resource_id)) continue;
      const arr = m.get(sr.service_id) ?? [];
      arr.push(sr.resource_id);
      m.set(sr.service_id, arr);
    }
    return m;
  }, [serviceResources, resources]);

  const staffBands = useMemo(() => {
    const list = staffList.filter((s) => effStaffIds.includes(s.id));
    return list.map((s) => ({ id: s.id, name: s.display_name, color: staffColor(s.id), ranges: rangesForStaffDay(s, day) }))
      .filter((x) => x.ranges.length > 0);
  }, [staffList, effStaffIds, day]);

  const dayBookings = useMemo(() => bookings.filter((b) => new Date(b.start_at).toDateString() === day.toDateString()), [bookings, day]);

  // Csak az adott napon érvényes erőforrás-hozzárendelések — a szűrt halmazból (sávok rajzolásához)
  const dayAssigns = useMemo(() => {
    const dEnd = addDays(day, 1);
    return assignments.filter((a) => {
      if (a.kind === "always" || a.kind === "scheduled") return true;
      if (a.kind === "window") return new Date(a.starts_at) < dEnd && new Date(a.ends_at) > day;
      if (a.kind === "weekly") {
        const dk = DAY_KEYS[day.getDay()];
        return !!a.weekly_pattern_json?.[dk]?.length;
      }
      return false;
    });
  }, [assignments, day]);

  // Releváns erőforrások az OSZLOP-elrendezéshez: a SZŰRETLEN halmazból számoljuk,
  // így a szűrés nem mozgatja át a foglalásokat másik szék/szoba oszlopba.
  const allDayBookings = useMemo(
    () => allBookings.filter((b) => new Date(b.start_at).toDateString() === day.toDateString()),
    [allBookings, day],
  );
  const allDayAssigns = useMemo(() => {
    const dEnd = addDays(day, 1);
    return allAssignments.filter((a) => {
      if (a.kind === "always" || a.kind === "scheduled") return true;
      if (a.kind === "window") return new Date(a.starts_at) < dEnd && new Date(a.ends_at) > day;
      if (a.kind === "weekly") {
        const dk = DAY_KEYS[day.getDay()];
        return !!a.weekly_pattern_json?.[dk]?.length;
      }
      return false;
    });
  }, [allAssignments, day]);
  const relevantResourceIds = useMemo(() => {
    if (!showResourceCols) return null;
    const s = new Set<string>();
    for (const b of allDayBookings) {
      if (b.resource_id) s.add(b.resource_id);
      (svcResMap.get(b.service_id) ?? []).forEach((id) => s.add(id));
    }
    for (const a of allDayAssigns) {
      if (a.resource_id) s.add(a.resource_id);
    }
    return s;
  }, [showResourceCols, allDayBookings, allDayAssigns, svcResMap]);

  const subcols = useMemo(() => buildSubcols(resources, showResourceCols, relevantResourceIds), [resources, showResourceCols, relevantResourceIds]);
  const placed = useMemo(() => placeBookings(dayBookings, subcols, svcResMap), [dayBookings, subcols, svcResMap]);

  // Minden subcolhoz: mely staff-sávok jelennek meg benne
  const staffBySubcol = useMemo(() => {
    const map = new Map<string, typeof staffBands>();
    for (const sc of subcols) {
      if (!sc.resourceId) {
        // Fallback (nincs erőforrás-oszlop): minden szűrt staff sávja
        map.set(sc.key, staffBands);
      } else {
        const sids = new Set<string>();
        for (const a of dayAssigns) {
          if (a.resource_id === sc.resourceId && a.staff_profile_id) sids.add(a.staff_profile_id);
        }
        // Bookings alapján is: ha a foglalás erre az erőforrásra (vagy a szolgáltatása erre mappelődik), a munkatárs jelen van
        for (const b of dayBookings) {
          if (!b.staff_profile_id) continue;
          const rid = b.resource_id ?? null;
          const mapped = svcResMap.get(b.service_id) ?? [];
          if (rid === sc.resourceId || mapped.includes(sc.resourceId)) {
            sids.add(b.staff_profile_id);
          }
        }
        map.set(sc.key, staffBands.filter((s) => sids.has(s.id)));
      }
    }
    return map;
  }, [subcols, dayAssigns, dayBookings, svcResMap, staffBands]);

  const totalH = (endMin - startMin) * PX_PER_MIN;
  const BAND_W = compact ? 4 : 6;
  // Erőforrás-fejléc: külön sáv a dátum alatt, fekete elválasztóval alatta és felette
  const hasHeader = showResourceCols && resources.some((r) => r.type === "room" || r.type === "chair");

  return (
    <div className="flex flex-col">
      {hasHeader && (
        <TooltipProvider delayDuration={150}>
          <div className="border-t-2 border-b-2 border-foreground bg-background">
            <div className="grid" style={{ gridTemplateColumns: `repeat(${subcols.length}, minmax(0,1fr))`, height: SUBCOL_HEADER_H }}>
              {subcols.map((c) => (
                <div key={c.key} className="border-l first:border-l-0 border-border px-0.5 py-0.5 overflow-hidden flex items-center justify-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="text-[10px] leading-tight font-medium text-center break-words w-full cursor-default"
                        style={{
                          color: c.color,
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {c.label}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <span className="text-sm font-medium">{c.label}</span>
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </div>
          </div>
        </TooltipProvider>
      )}
      <div className="flex" style={{ height: totalH }}>
        <div className="relative flex-1">
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${subcols.length}, minmax(0,1fr))` }}>
            {subcols.map((c) => {
              const bands = staffBySubcol.get(c.key) ?? [];
              return (
                <div key={c.key} className="relative border-l first:border-l-0 border-border overflow-hidden">
                  {/* Munkatárs-sávok: a subcol bal oldalán, keskeny, függőleges */}
                  <div className="absolute top-0 bottom-0 left-0 flex gap-px pointer-events-none">
                    {bands.map((s) => (
                      <div key={s.id} className="relative h-full" style={{ width: BAND_W }} title={s.name}>
                        {s.ranges.map(([a, b], i) => {
                          const top = Math.max(0, (a - startMin)) * PX_PER_MIN;
                          const h = Math.max(0, Math.min(b, endMin) - Math.max(a, startMin)) * PX_PER_MIN;
                          if (h <= 0) return null;
                          return (
                            <div
                              key={i}
                              className="absolute left-0 right-0 rounded-sm opacity-70"
                              style={{ top, height: h, background: s.color }}
                              title={`${s.name}: ${fmtHM(a)}–${fmtHM(b)}`}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: Math.ceil((endMin - startMin) / 15) + 1 }, (_, i) => {
              const totalMin = Math.floor(startMin / 15) * 15 + i * 15;
              if (totalMin < startMin || totalMin > endMin) return null;
              const top = (totalMin - startMin) * PX_PER_MIN;
              const isHour = totalMin % 60 === 0;
              const isHalf = totalMin % 30 === 0;
              const cls = isHour
                ? "border-t border-foreground/60"
                : isHalf
                ? "border-t border-dashed border-foreground/30"
                : "border-t border-dotted border-foreground/15";
              return <div key={i} className={`absolute inset-x-0 ${cls}`} style={{ top }} />;
            })}
          </div>
          {placed.map((p) => {
            const top = (p.topMin - startMin) * PX_PER_MIN;
            const h = p.durMin * PX_PER_MIN;
            const widthPct = 100 / subcols.length;
            const leftPct = p.subcolIdx * widthPct;
            const bg = bookingColor(p.b.services?.tags);
            const sc = subcols[p.subcolIdx];
            const nextSc = subcols[p.subcolIdx + 1];
            const bandsCount = (staffBySubcol.get(sc?.key ?? "") ?? []).length;
            const nextBandsCount = nextSc ? (staffBySubcol.get(nextSc.key) ?? []).length : 0;
            const bandsW = (n: number) => (n > 0 ? n * BAND_W + (n - 1) + 3 : 1);
            const leftPad = bandsW(bandsCount);
            // Jobb oldalon: ha van következő subcol, hagyjuk üresen annak sávjait
            const rightPad = nextSc ? bandsW(nextBandsCount) : 2;
            return (
              <button
                key={p.b.id}
                type="button"
                onClick={() => onSelect(p.b)}
                className="absolute rounded text-left overflow-hidden text-white shadow-sm hover:opacity-90 hover:z-20 px-1 py-0.5 border border-white/40"
                style={{ top, height: Math.max(h, 18), left: `calc(${leftPct}% + ${leftPad}px)`, width: `calc(${widthPct}% - ${leftPad + rightPad}px)`, background: bg, fontSize: compact ? 9 : 10, lineHeight: 1.1 }}
                title={`${p.b.services?.name ?? ""} · ${p.b.customers?.full_name ?? ""}`}
              >
                <div className="font-semibold truncate">{fmtHM(p.topMin)} {p.b.services?.name}</div>
                {h > 28 && <div className="truncate opacity-95">{p.b.customers?.full_name}</div>}
                {h > 42 && p.b.staff_profiles?.display_name && <div className="truncate opacity-80">{p.b.staff_profiles.display_name}</div>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function computeRangeBounds(days: Date[], staffList: any[], filterStaffIds: string[]): [number, number] {
  const all: Array<[number, number]> = [];
  const list = filterStaffIds.length > 0 ? staffList.filter((s) => filterStaffIds.includes(s.id)) : staffList;
  for (const d of days) for (const s of list) all.push(...rangesForStaffDay(s, d));
  if (all.length === 0) return [7 * 60, 19 * 60];
  const minH = Math.max(0, Math.floor(Math.min(...all.map((r) => r[0])) / 60) - 1);
  const maxH = Math.min(24, Math.ceil(Math.max(...all.map((r) => r[1])) / 60) + 1);
  return [minH * 60, Math.max(maxH * 60, minH * 60 + 120)];
}

function TimeAxis({ startMin, endMin }: { startMin: number; endMin: number }) {
  const hours: number[] = [];
  for (let h = Math.ceil(startMin / 60); h <= Math.floor(endMin / 60); h++) hours.push(h);
  return (
    <div className="relative shrink-0" style={{ width: 44, height: (endMin - startMin) * PX_PER_MIN }}>
      {hours.map((h) => (
        <div key={h} className="absolute right-1 text-[10px] text-muted-foreground" style={{ top: (h * 60 - startMin) * PX_PER_MIN - 6 }}>
          {String(h).padStart(2, "0")}:00
        </div>
      ))}
    </div>
  );
}

function DayView({ bookings, allBookings, assignments, allAssignments, day, onSelect, staffList, effStaffIds, resources, serviceResources, showResourceCols }: {
  bookings: any[]; allBookings: any[]; assignments: any[]; allAssignments: any[]; day: Date; onSelect: (b: any) => void; staffList: any[]; effStaffIds: string[]; resources: any[]; serviceResources: any[]; showResourceCols: boolean;
}) {
  const [startMin, endMin] = useMemo(() => computeRangeBounds([day], staffList, effStaffIds), [day, staffList, effStaffIds]);
  const dayEnd = addDays(day, 1);
  const dayAssigns = assignments.filter((a) => {
    if (a.kind === "always" || a.kind === "scheduled") return true;
    if (a.kind === "window") return new Date(a.starts_at) < dayEnd && new Date(a.ends_at) > day;
    if (a.kind === "weekly") {
      const dk = DAY_KEYS[day.getDay()];
      return !!a.weekly_pattern_json?.[dk]?.length;
    }
    return false;
  });
  return (
    <Card className="p-3">
      <div className="text-sm font-semibold mb-3">{day.toLocaleDateString("hu-HU", { weekday: "long", month: "long", day: "numeric" })}</div>
      {dayAssigns.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3 pb-3 border-b">
          {dayAssigns.map((a) => <AssignmentChip key={a.id} a={a} />)}
        </div>
      )}
      <div className="flex">
        <div className="flex flex-col">
          {showResourceCols && resources.some((r) => r.type === "room" || r.type === "chair") && (
            <div className="border-t-2 border-b-2 border-foreground" style={{ width: 44, height: SUBCOL_HEADER_H }} />
          )}
          <TimeAxis startMin={startMin} endMin={endMin} />
        </div>
        <div className="flex-1">
          <TimeGridDay day={day} bookings={bookings} allBookings={allBookings} assignments={assignments} allAssignments={allAssignments} staffList={staffList} effStaffIds={effStaffIds} resources={resources} serviceResources={serviceResources} showResourceCols={showResourceCols} onSelect={onSelect} startMin={startMin} endMin={endMin} />
        </div>
      </div>
      <CalendarLegend staffList={staffList.filter((s) => effStaffIds.includes(s.id))} bookings={bookings} resources={resources} showResourceCols={showResourceCols} />
    </Card>
  );
}

function WeekView({ bookings, allBookings, assignments, allAssignments, weekStart, onSelect, staffList, effStaffIds, resources, serviceResources, showResourceCols }: {
  bookings: any[]; allBookings: any[]; assignments: any[]; allAssignments: any[]; weekStart: Date; onSelect: (b: any) => void; staffList: any[]; effStaffIds: string[]; resources: any[]; serviceResources: any[]; showResourceCols: boolean;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const [startMin, endMin] = useMemo(() => computeRangeBounds(days, staffList, effStaffIds), [days, staffList, effStaffIds]);
  const today = new Date().toDateString();
  return (
    <Card className="p-2 overflow-x-auto">
      <div className="min-w-[900px]">
        <div className="flex">
          <div className="shrink-0" style={{ width: 44 }} />
          <div className="flex-1 grid" style={{ gridTemplateColumns: "repeat(7, minmax(0,1fr))" }}>
            {days.map((d) => {
              const dayEnd = addDays(d, 1);
              const dayAssigns = assignments.filter((a) => {
                if (a.kind === "always" || a.kind === "scheduled") return true;
                if (a.kind === "window") return new Date(a.starts_at) < dayEnd && new Date(a.ends_at) > d;
                if (a.kind === "weekly") {
                  const dk = DAY_KEYS[d.getDay()];
                  return !!a.weekly_pattern_json?.[dk]?.length;
                }
                return false;
              });
              const isToday = d.toDateString() === today;
              return (
                <div key={d.toISOString()} className={`px-1 py-1 text-center border-b border-l-2 first:border-l-0 border-foreground ${isToday ? "bg-primary/10" : ""}`}>
                  <div className="text-[10px] uppercase text-muted-foreground">{d.toLocaleDateString("hu-HU", { weekday: "short" })}</div>
                  <div className="text-sm font-semibold">{d.getDate()}</div>
                  {dayAssigns.length > 0 && <div className="text-[9px] text-muted-foreground mt-0.5">🔒 {dayAssigns.length}</div>}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex">
          <div className="flex flex-col">
            {showResourceCols && resources.some((r) => r.type === "room" || r.type === "chair") && (
              <div className="border-t-2 border-b-2 border-foreground" style={{ width: 44, height: SUBCOL_HEADER_H }} />
            )}
            <TimeAxis startMin={startMin} endMin={endMin} />
          </div>
          <div className="flex-1 grid" style={{ gridTemplateColumns: "repeat(7, minmax(0,1fr))" }}>
            {days.map((d) => (
              <div key={d.toISOString()} className="border-l-2 first:border-l-0 border-foreground overflow-hidden">
                <TimeGridDay day={d} bookings={bookings} allBookings={allBookings} assignments={assignments} allAssignments={allAssignments} staffList={staffList} effStaffIds={effStaffIds} resources={resources} serviceResources={serviceResources} showResourceCols={showResourceCols} onSelect={onSelect} startMin={startMin} endMin={endMin} compact />
              </div>
            ))}
          </div>
        </div>
        <CalendarLegend staffList={staffList.filter((s) => effStaffIds.includes(s.id))} bookings={bookings} resources={resources} showResourceCols={showResourceCols} />
      </div>
    </Card>
  );
}

function CalendarLegend({ staffList, bookings, resources, showResourceCols }: { staffList: any[]; bookings: any[]; resources: any[]; showResourceCols: boolean }) {
  const tagSet = new Set<string>();
  for (const b of bookings) for (const t of (b.services?.tags ?? [])) tagSet.add(t);
  const tags = Array.from(tagSet);
  const locs = resources.filter((r) => r.type === "room" || r.type === "chair");
  return (
    <div className="mt-3 pt-2 border-t flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {staffList.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">Munkatársak:</span>
          {staffList.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1">
              <span className="inline-block w-2.5 h-3 rounded-sm" style={{ background: staffColor(s.id) }} />{s.display_name}
            </span>
          ))}
        </div>
      )}
      {tags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">Címkék:</span>
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded" style={{ background: tagColor(t) }} />{t}
            </span>
          ))}
        </div>
      )}
      {showResourceCols && locs.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">Erőforrások:</span>
          {locs.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded border" style={{ borderColor: resourceColor(r.id), color: resourceColor(r.id) }} />
              <span style={{ color: resourceColor(r.id) }}>{r.name}{(r.capacity ?? 1) > 1 ? ` ×${r.capacity}` : ""}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MonthView({ bookings, monthStart, onSelect }: { bookings: any[]; monthStart: Date; onSelect: (b: any) => void }) {
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const monthIdx = monthStart.getMonth();
  const weekdays = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];
  return (
    <TooltipProvider delayDuration={150}>
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
                  {dayBookings.slice(0, 3).map((b) => {
                    const bg = bookingColor(b.services?.tags);
                    const sIso = new Date(b.start_at);
                    const eIso = new Date(b.end_at);
                    const timeStr = sIso.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
                    const endStr = eIso.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
                    return (
                      <Tooltip key={b.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => onSelect(b)}
                            className="block w-full text-left text-[10px] text-white rounded px-1 py-0.5 truncate hover:opacity-90 border border-white/30"
                            style={{ background: bg }}
                          >
                            {timeStr} {b.services?.name}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <div className="text-xs space-y-0.5">
                            <div className="font-semibold">{b.services?.name ?? "—"}</div>
                            <div>{timeStr}–{endStr}</div>
                            {b.customers?.full_name && <div>Ügyfél: {b.customers.full_name}</div>}
                            {b.staff_profiles?.display_name && <div>Munkatárs: {b.staff_profiles.display_name}</div>}
                            {b.status && <div>Státusz: {b.status}</div>}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                  {dayBookings.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayBookings.length - 3}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </TooltipProvider>
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

  const [pendingConflicts, setPendingConflicts] = useState<ConflictItem[] | null>(null);
  const updMut = useMutation({
    mutationFn: (force: boolean) => update({ data: { bookingId: booking.id, startAt: new Date(newStart).toISOString(), force } }),
    onSuccess: () => { toast.success("Időpont módosítva — ügyfél értesítve"); qc.invalidateQueries({ queryKey: ["cal-bookings"] }); setPendingConflicts(null); onClose(); },
    onError: (e: any) => {
      const items = parseConflictsFromError(e);
      if (items) { setPendingConflicts(items); return; }
      toast.error(e.message);
    },
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
                <Button onClick={() => updMut.mutate(false)} disabled={updMut.isPending}>Áthelyezés</Button>
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
      <ConflictDialog
        open={!!pendingConflicts}
        onOpenChange={(o) => { if (!o) setPendingConflicts(null); }}
        conflicts={pendingConflicts ?? []}
        title="Időpont-áthelyezés ütközik"
        onConfirm={() => updMut.mutate(true)}
        onCancel={() => setPendingConflicts(null)}
        pending={updMut.isPending}
      />
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

function NewBookingDialog({ open, onClose, orgId, services, staffList, defaultStaffId, onCreated }: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  services: any[];
  staffList: any[];
  defaultStaffId: string | null;
  onCreated: () => void;
}) {
  const createFn = useServerFn(createInternalBooking);
  const checkFn = useServerFn(checkInternalBookingConflicts);
  const [serviceId, setServiceId] = useState("");
  const [staffProfileId, setStaffProfileId] = useState<string>(defaultStaffId ?? "");
  const [startAt, setStartAt] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [needsForce, setNeedsForce] = useState(false);

  // Reset on open
  useMemo(() => {
    if (open) {
      setServiceId(""); setStaffProfileId(defaultStaffId ?? "");
      setStartAt(""); setName(""); setEmail(""); setPhone(""); setNote("");
      setWarnings([]); setNeedsForce(false);
    }
  }, [open, defaultStaffId]);

  const create = useMutation({
    mutationFn: (force: boolean) => createFn({ data: {
      organizationId: orgId,
      serviceId,
      staffProfileId: staffProfileId || null,
      startAt: new Date(startAt).toISOString(),
      customerName: name,
      customerEmail: email || null,
      customerPhone: phone || null,
      note: note || null,
      force,
    }}),
    onSuccess: (res: any) => {
      toast.success(res.warnings?.length ? "Foglalás rögzítve (figyelmeztetésekkel)" : "Foglalás rögzítve");
      onCreated(); onClose();
    },
    onError: (e: any) => {
      const items = parseConflictsFromError(e);
      if (items) {
        setWarnings(items.map((it) => it.message));
        setNeedsForce(true);
      } else {
        toast.error(String(e.message || ""));
      }
    },
  });

  const preCheck = useMutation({
    mutationFn: () => checkFn({ data: {
      organizationId: orgId,
      serviceId,
      staffProfileId: staffProfileId || null,
      startAt: new Date(startAt).toISOString(),
      customerName: name || "Belső",
      customerEmail: email || null,
      customerPhone: phone || null,
      note: null,
      force: false,
    }}),
    onSuccess: (res: any) => {
      setWarnings(res.warnings ?? []);
      setNeedsForce((res.warnings ?? []).length > 0);
    },
    onError: () => {},
  });

  const ready = serviceId && startAt && name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Új belső foglalás</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Szolgáltatás</Label>
            <Select value={serviceId} onValueChange={(v) => { setServiceId(v); setWarnings([]); setNeedsForce(false); }}>
              <SelectTrigger><SelectValue placeholder="Válassz" /></SelectTrigger>
              <SelectContent>{services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Munkatárs (opcionális)</Label>
            <Select value={staffProfileId || "__none__"} onValueChange={(v) => { setStaffProfileId(v === "__none__" ? "" : v); setWarnings([]); setNeedsForce(false); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Nincs —</SelectItem>
                {staffList.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.display_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Időpont</Label>
            <Input type="datetime-local" value={startAt} onChange={(e) => { setStartAt(e.target.value); setWarnings([]); setNeedsForce(false); }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Ügyfél neve</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>Telefon</Label><PhoneInput value={phone} onChange={setPhone} /></div>
          </div>
          <div><Label>E-mail (opcionális)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label>Megjegyzés</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>

          {ready && (
            <Button type="button" variant="outline" size="sm" onClick={() => preCheck.mutate()} disabled={preCheck.isPending}>
              Ütközés-ellenőrzés
            </Button>
          )}

          {warnings.length > 0 && (
            <div className="rounded border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
              <div className="font-semibold mb-1 text-amber-700 dark:text-amber-300">⚠ Figyelmeztetések:</div>
              <ul className="list-disc pl-5 space-y-0.5 text-amber-900 dark:text-amber-200">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Mégsem</Button>
          {needsForce ? (
            <Button variant="destructive" onClick={() => create.mutate(true)} disabled={!ready || create.isPending}>
              Mindenképp rögzítem
            </Button>
          ) : (
            <Button onClick={() => create.mutate(false)} disabled={!ready || create.isPending}>
              Rögzítés
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
