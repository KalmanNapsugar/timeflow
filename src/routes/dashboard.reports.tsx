import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, Calendar, Award, XCircle } from "lucide-react";

export const Route = createFileRoute("/dashboard/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  const [days, setDays] = useState("30");

  const since = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000).toISOString();

  const { data: bookings } = useQuery({
    queryKey: ["report-bookings", orgId, days], enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from("bookings")
        .select("id, start_at, end_at, status, price_total, payment_status, service_id, services(name)")
        .eq("organization_id", orgId)
        .gte("start_at", since);
      return data ?? [];
    },
  });

  if (!orgId) return <p className="text-muted-foreground">Először hozz létre egy üzletet.</p>;
  if (!bookings) return <p>Betöltés…</p>;

  const totalRevenue = bookings
    .filter((b: any) => b.status !== "cancelled" && b.payment_status !== "refunded")
    .reduce((s: number, b: any) => s + Number(b.price_total || 0), 0);

  const noShows = bookings.filter((b: any) => b.status === "no_show").length;
  const cancellations = bookings.filter((b: any) => b.status === "cancelled").length;
  const confirmed = bookings.filter((b: any) => b.status === "confirmed" || b.status === "completed").length;

  const totalMinutes = bookings
    .filter((b: any) => b.status !== "cancelled")
    .reduce((s: number, b: any) => s + (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000, 0);
  const utilizationHours = (totalMinutes / 60).toFixed(1);

  const serviceCounts: Record<string, { name: string; count: number; revenue: number }> = {};
  bookings.forEach((b: any) => {
    const name = b.services?.name ?? "—";
    if (!serviceCounts[name]) serviceCounts[name] = { name, count: 0, revenue: 0 };
    serviceCounts[name].count += 1;
    serviceCounts[name].revenue += Number(b.price_total || 0);
  });
  const topServices = Object.values(serviceCounts).sort((a, b) => b.count - a.count).slice(0, 5);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Riportok</h1>
          <p className="text-muted-foreground text-sm">Üzleti teljesítmény áttekintése.</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Utolsó 7 nap</SelectItem>
            <SelectItem value="30">Utolsó 30 nap</SelectItem>
            <SelectItem value="90">Utolsó 90 nap</SelectItem>
            <SelectItem value="365">Utolsó 1 év</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp className="w-3 h-3" /> Bevétel</div>
          <div className="text-2xl font-bold">{totalRevenue.toLocaleString("hu-HU")} Ft</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Calendar className="w-3 h-3" /> Foglalt órák</div>
          <div className="text-2xl font-bold">{utilizationHours} óra</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Award className="w-3 h-3" /> Sikeres foglalás</div>
          <div className="text-2xl font-bold">{confirmed}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><XCircle className="w-3 h-3" /> No-show / lemondás</div>
          <div className="text-2xl font-bold">{noShows} / {cancellations}</div>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Legnépszerűbb szolgáltatások</h2>
        {topServices.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nincs adat ebben az időszakban.</p>
        ) : (
          <div className="space-y-2">
            {topServices.map((s, i) => (
              <div key={s.name} className="flex items-center justify-between border-b last:border-b-0 pb-2 last:pb-0">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground text-sm w-6">#{i + 1}</span>
                  <span className="font-medium">{s.name}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {s.count} foglalás · {s.revenue.toLocaleString("hu-HU")} Ft
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
