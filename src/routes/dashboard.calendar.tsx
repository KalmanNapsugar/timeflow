import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/dashboard/calendar")({
  component: CalendarPage,
});

function startOfWeek(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = (date.getDay() + 6) % 7; // monday=0
  date.setDate(date.getDate() - day);
  return date;
}

function CalendarPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);

  const { data: bookings } = useQuery({
    queryKey: ["cal-bookings", orgId, weekStart.toISOString()],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("*, services(name), customers(full_name), staff_profiles(display_name)")
        .eq("organization_id", orgId)
        .gte("start_at", weekStart.toISOString())
        .lt("start_at", weekEnd.toISOString())
        .order("start_at");
      return data ?? [];
    },
  });

  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400000));

  if (!orgId) return <p className="text-muted-foreground">Először rendelj magadhoz egy szervezetet az Áttekintés oldalon.</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Naptár</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 86400000))}><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>Ma</Button>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 86400000))}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
        {days.map((day) => {
          const dayBookings = (bookings ?? []).filter((b: any) => {
            const d = new Date(b.start_at);
            return d.toDateString() === day.toDateString();
          });
          return (
            <Card key={day.toISOString()} className="p-3 min-h-[180px]">
              <div className="text-xs uppercase text-muted-foreground">{day.toLocaleDateString("hu-HU", { weekday: "short" })}</div>
              <div className="font-semibold mb-2">{day.getDate()}</div>
              <div className="space-y-1">
                {dayBookings.map((b: any) => (
                  <div key={b.id} className="text-xs bg-primary/10 rounded p-1.5">
                    <div className="font-medium">{new Date(b.start_at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="truncate">{b.services?.name}</div>
                    <div className="truncate text-muted-foreground">{b.customers?.full_name}</div>
                  </div>
                ))}
                {dayBookings.length === 0 && <div className="text-xs text-muted-foreground">—</div>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
