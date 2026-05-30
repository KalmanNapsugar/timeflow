import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CalendarDays, List, CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/my-bookings")({
  head: () => ({ meta: [{ title: "Foglalásaim" }] }),
  component: MyBookings,
});

function MyBookings() {
  const { user, loading } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // hétfő = 0
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d;
  });

  const { data } = useQuery({
    queryKey: ["my-bookings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("*, services(name), organizations(name, slug)")
        .eq("customer_auth_user_id", user!.id)
        .order("start_at", { ascending: false });
      return data ?? [];
    },
  });

  const bookedDays = useMemo(() => {
    return (data ?? []).map((b: any) => new Date(b.start_at));
  }, [data]);

  const dayBookings = useMemo(() => {
    if (!selectedDate || !data) return [];
    const ymd = selectedDate.toDateString();
    return data.filter((b: any) => new Date(b.start_at).toDateString() === ymd);
  }, [selectedDate, data]);

  if (loading) return <div className="container mx-auto p-10">Betöltés…</div>;
  if (!user) return (
    <div className="container mx-auto p-10 text-center">
      <p className="mb-4">Jelentkezz be a foglalásaid megtekintéséhez.</p>
      <Button asChild><Link to="/login">Bejelentkezés</Link></Button>
    </div>
  );

  return (
    <div className="min-h-screen container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Foglalásaim</h1>

      <Tabs defaultValue="list" className="w-full">
        <TabsList>
          <TabsTrigger value="list"><List className="w-4 h-4 mr-1" /> Lista</TabsTrigger>
          <TabsTrigger value="week"><CalendarRange className="w-4 h-4 mr-1" /> Heti</TabsTrigger>
          <TabsTrigger value="calendar"><CalendarDays className="w-4 h-4 mr-1" /> Havi</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <div className="space-y-3">
            {data?.length === 0 && <p className="text-muted-foreground">Még nincs foglalásod.</p>}
            {data?.map((b: any) => (
              <Card key={b.id} className="p-4 flex items-start justify-between shadow-soft gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{b.services?.name}</div>
                  <div className="text-sm text-muted-foreground">{b.organizations?.name}</div>
                  <div className="text-sm">{new Date(b.start_at).toLocaleString("hu-HU")}</div>
                  {b.note && b.note_visible_to_customer && (
                    <div className="mt-2 text-sm bg-muted/50 rounded px-2 py-1 whitespace-pre-wrap">
                      <span className="font-medium">Megjegyzés:</span> {b.note}
                    </div>
                  )}
                </div>
                <Badge>{b.status}</Badge>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="week" className="mt-4">
          {(() => {
            const days = Array.from({ length: 7 }, (_, i) => {
              const d = new Date(weekStart); d.setDate(d.getDate() + i); return d;
            });
            const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 7:00 - 20:00
            const slotHeight = 48; // px / óra
            const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
            const weekBookings = (data ?? []).filter((b: any) => {
              const t = new Date(b.start_at).getTime();
              return t >= weekStart.getTime() && t < weekEnd.getTime();
            });
            return (
              <Card className="p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold">
                    {weekStart.toLocaleDateString("hu-HU", { month: "long", day: "numeric" })}
                    {" – "}
                    {new Date(weekEnd.getTime() - 1).toLocaleDateString("hu-HU", { month: "long", day: "numeric", year: "numeric" })}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); }}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      const d = new Date(); const day = (d.getDay() + 6) % 7;
                      d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); setWeekStart(d);
                    }}>Ma</Button>
                    <Button size="sm" variant="outline" onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); }}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <div className="grid min-w-[700px]" style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}>
                    <div />
                    {days.map((d, i) => {
                      const isToday = d.toDateString() === new Date().toDateString();
                      return (
                        <div key={i} className={`text-center text-xs font-semibold p-2 border-b ${isToday ? "text-primary" : ""}`}>
                          <div>{d.toLocaleDateString("hu-HU", { weekday: "short" })}</div>
                          <div className="text-base">{d.getDate()}</div>
                        </div>
                      );
                    })}
                    <div className="border-r">
                      {hours.map(h => (
                        <div key={h} style={{ height: slotHeight }} className="text-xs text-muted-foreground pr-2 text-right -mt-2">
                          {String(h).padStart(2, "0")}:00
                        </div>
                      ))}
                    </div>
                    {days.map((d, di) => {
                      const dayBs = weekBookings.filter((b: any) => new Date(b.start_at).toDateString() === d.toDateString());
                      return (
                        <div key={di} className="relative border-r" style={{ height: hours.length * slotHeight }}>
                          {hours.map(h => (
                            <div key={h} style={{ height: slotHeight }} className="border-b border-dashed border-border/40" />
                          ))}
                          {dayBs.map((b: any) => {
                            const s = new Date(b.start_at), e = new Date(b.end_at);
                            const startMin = s.getHours() * 60 + s.getMinutes();
                            const endMin = e.getHours() * 60 + e.getMinutes();
                            const top = ((startMin - hours[0] * 60) / 60) * slotHeight;
                            const height = Math.max(20, ((endMin - startMin) / 60) * slotHeight);
                            if (top < 0 || top > hours.length * slotHeight) return null;
                            return (
                              <div key={b.id} className="absolute left-1 right-1 rounded bg-primary/90 text-primary-foreground p-1 text-xs shadow-sm overflow-hidden"
                                style={{ top, height }} title={`${b.services?.name} – ${b.organizations?.name}`}>
                                <div className="font-semibold truncate">{b.services?.name}</div>
                                <div className="truncate opacity-90">{b.organizations?.name}</div>
                                <div className="opacity-80">
                                  {s.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {weekBookings.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center mt-3">Ezen a héten nincs foglalásod.</p>
                )}
              </Card>
            );
          })()}
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="p-4">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                modifiers={{ booked: bookedDays }}
                modifiersClassNames={{ booked: "bg-primary/20 font-semibold text-primary" }}
                className="rounded-md"
              />
              <p className="text-xs text-muted-foreground mt-3">
                A kiemelt napokon van foglalásod.
              </p>
            </Card>
            <div className="space-y-3">
              <h2 className="font-semibold">
                {selectedDate?.toLocaleDateString("hu-HU", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              </h2>
              {dayBookings.length === 0 && (
                <p className="text-sm text-muted-foreground">Ezen a napon nincs foglalásod.</p>
              )}
              {dayBookings.map((b: any) => (
                <Card key={b.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{b.services?.name}</div>
                      <div className="text-sm text-muted-foreground">{b.organizations?.name}</div>
                      <div className="text-sm">
                        {new Date(b.start_at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}
                        {" – "}
                        {new Date(b.end_at).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <Badge>{b.status}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
