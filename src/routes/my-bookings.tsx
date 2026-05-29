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
import { CalendarDays, List } from "lucide-react";

export const Route = createFileRoute("/my-bookings")({
  head: () => ({ meta: [{ title: "Foglalásaim" }] }),
  component: MyBookings,
});

function MyBookings() {
  const { user, loading } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());

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
          <TabsTrigger value="calendar"><CalendarDays className="w-4 h-4 mr-1" /> Naptár</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <div className="space-y-3">
            {data?.length === 0 && <p className="text-muted-foreground">Még nincs foglalásod.</p>}
            {data?.map((b: any) => (
              <Card key={b.id} className="p-4 flex items-center justify-between shadow-soft">
                <div>
                  <div className="font-semibold">{b.services?.name}</div>
                  <div className="text-sm text-muted-foreground">{b.organizations?.name}</div>
                  <div className="text-sm">{new Date(b.start_at).toLocaleString("hu-HU")}</div>
                </div>
                <Badge>{b.status}</Badge>
              </Card>
            ))}
          </div>
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
