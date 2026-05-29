import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/dashboard/calendar")({
  component: CalendarPage,
});

type ViewMode = "day" | "week" | "month" | "agenda";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d: Date) {
  const date = startOfDay(d);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
}
function startOfMonth(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86400000);
}

function CalendarPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

  // Compute range based on view
  let rangeStart: Date;
  let rangeEnd: Date;
  if (view === "day") {
    rangeStart = startOfDay(anchor);
    rangeEnd = addDays(rangeStart, 1);
  } else if (view === "week") {
    rangeStart = startOfWeek(anchor);
    rangeEnd = addDays(rangeStart, 7);
  } else if (view === "month") {
    rangeStart = startOfMonth(anchor);
    rangeEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  } else {
    rangeStart = startOfDay(anchor);
    rangeEnd = addDays(rangeStart, 30);
  }

  const { data: bookings } = useQuery({
    queryKey: ["cal-bookings", orgId, view, rangeStart.toISOString()],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("*, services(name), customers(full_name), staff_profiles(display_name)")
        .eq("organization_id", orgId)
        .gte("start_at", rangeStart.toISOString())
        .lt("start_at", rangeEnd.toISOString())
        .order("start_at");
      return data ?? [];
    },
  });

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

      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => go(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={() => setAnchor(startOfDay(new Date()))}>Ma</Button>
          <Button variant="outline" size="icon" onClick={() => go(1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>

      {view === "day" && <DayView bookings={bookings ?? []} day={rangeStart} />}
      {view === "week" && <WeekView bookings={bookings ?? []} weekStart={rangeStart} />}
      {view === "month" && <MonthView bookings={bookings ?? []} monthStart={rangeStart} />}
      {view === "agenda" && <AgendaView bookings={bookings ?? []} />}
    </div>
  );
}

function BookingItem({ b }: { b: any }) {
  return (
    <div className="text-xs bg-primary/10 rounded p-1.5">
      <div className="font-medium">{new Date(b.start_at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}</div>
      <div className="truncate">{b.services?.name}</div>
      <div className="truncate text-muted-foreground">{b.customers?.full_name}</div>
    </div>
  );
}

function DayView({ bookings, day }: { bookings: any[]; day: Date }) {
  const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 7..20
  return (
    <Card className="p-4">
      <div className="text-sm font-semibold mb-3">{day.toLocaleDateString("hu-HU", { weekday: "long", month: "long", day: "numeric" })}</div>
      <div className="divide-y">
        {hours.map((h) => {
          const items = bookings.filter((b) => new Date(b.start_at).getHours() === h);
          return (
            <div key={h} className="flex gap-3 py-2">
              <div className="w-14 text-xs text-muted-foreground pt-1">{String(h).padStart(2, "0")}:00</div>
              <div className="flex-1 space-y-1">
                {items.length === 0 ? <div className="text-xs text-muted-foreground">—</div> : items.map((b) => <BookingItem key={b.id} b={b} />)}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekView({ bookings, weekStart }: { bookings: any[]; weekStart: Date }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
      {days.map((day) => {
        const dayBookings = bookings.filter((b) => new Date(b.start_at).toDateString() === day.toDateString());
        return (
          <Card key={day.toISOString()} className="p-3 min-h-[180px]">
            <div className="text-xs uppercase text-muted-foreground">{day.toLocaleDateString("hu-HU", { weekday: "short" })}</div>
            <div className="font-semibold mb-2">{day.getDate()}</div>
            <div className="space-y-1">
              {dayBookings.map((b) => <BookingItem key={b.id} b={b} />)}
              {dayBookings.length === 0 && <div className="text-xs text-muted-foreground">—</div>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function MonthView({ bookings, monthStart }: { bookings: any[]; monthStart: Date }) {
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
                  <div key={b.id} className="text-[10px] bg-primary/10 rounded px-1 py-0.5 truncate">
                    {new Date(b.start_at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })} {b.services?.name}
                  </div>
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

function AgendaView({ bookings }: { bookings: any[] }) {
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
              <div key={b.id} className="flex items-start gap-3 text-sm border-l-2 border-primary pl-3">
                <div className="w-16 text-muted-foreground">{new Date(b.start_at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}</div>
                <div className="flex-1">
                  <div className="font-medium">{b.services?.name}</div>
                  <div className="text-muted-foreground text-xs">{b.customers?.full_name} {b.staff_profiles?.display_name ? `• ${b.staff_profiles.display_name}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
