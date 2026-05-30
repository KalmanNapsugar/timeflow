import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { BarChart3 } from "lucide-react";
import { listBookingAudit } from "@/lib/booking-stats.functions";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";

const CHART_COLORS = ["hsl(var(--primary))", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#3b82f6"];

export const Route = createFileRoute("/dashboard/stats")({
  head: () => ({ meta: [{ title: "Statisztikák" }] }),
  component: StatsPage,
});

type GroupKey = "staff" | "service" | "week" | "month" | "newReturning" | "none";

function bucketLabel(row: any, key: GroupKey): string {
  if (key === "staff") return row.staff_name ?? "(nincs)";
  if (key === "service") return row.service_name ?? "(nincs)";
  if (key === "newReturning") return row.is_new_customer ? "Új vendég" : "Visszatérő";
  if (key === "week") {
    const d = new Date(row.start_at);
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()} W${String(week).padStart(2, "0")}`;
  }
  if (key === "month") {
    const d = new Date(row.start_at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return "Összes";
}

function StatsPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [staffId, setStaffId] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [onlyPrepaid, setOnlyPrepaid] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [rowKey, setRowKey] = useState<GroupKey>("staff");
  const [colKey, setColKey] = useState<GroupKey>("month");

  const fetchAudit = useServerFn(listBookingAudit);
  const { data, isLoading } = useQuery({
    queryKey: ["audit", orgId, from, to, staffId, serviceId, onlyPrepaid, onlyNew],
    enabled: !!orgId,
    queryFn: () => fetchAudit({ data: {
      organizationId: orgId!,
      fromISO: from ? new Date(from).toISOString() : undefined,
      toISO: to ? new Date(to + "T23:59:59").toISOString() : undefined,
      staffProfileId: staffId || null,
      serviceId: serviceId || null,
      onlyPrepaid,
      onlyNewCustomers: onlyNew,
    } }),
  });

  const { data: staffList } = useQuery({
    queryKey: ["staff-opts", orgId],
    enabled: !!orgId,
    queryFn: async () => (await supabase.from("staff_profiles").select("id, display_name").eq("organization_id", orgId)).data ?? [],
  });
  const { data: serviceList } = useQuery({
    queryKey: ["svc-opts", orgId],
    enabled: !!orgId,
    queryFn: async () => (await supabase.from("services").select("id, name").eq("organization_id", orgId)).data ?? [],
  });

  const pivot = useMemo(() => {
    const rows = data?.rows ?? [];
    const rowKeys = new Set<string>();
    const colKeys = new Set<string>();
    const cells = new Map<string, { count: number; revenue: number }>();
    for (const r of rows) {
      const rk = bucketLabel(r, rowKey);
      const ck = bucketLabel(r, colKey);
      rowKeys.add(rk); colKeys.add(ck);
      const k = `${rk}||${ck}`;
      const cur = cells.get(k) ?? { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += Number(r.service_price ?? 0);
      cells.set(k, cur);
    }
    const totalCount = rows.length;
    const totalRevenue = rows.reduce((a: number, r: any) => a + Number(r.service_price ?? 0), 0);
    const newCount = rows.filter((r: any) => r.is_new_customer).length;
    const prepaidCount = rows.filter((r: any) => r.prepaid).length;
    return {
      rowKeys: [...rowKeys].sort(),
      colKeys: [...colKeys].sort(),
      cells,
      totals: { totalCount, totalRevenue, newCount, prepaidCount },
    };
  }, [data, rowKey, colKey]);

  if (!orgId) return <p className="text-muted-foreground">Először rendelj magadhoz egy szervezetet.</p>;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2 flex items-center gap-2"><BarChart3 className="w-7 h-7" /> Statisztikák</h1>
      <p className="text-muted-foreground mb-6">Pivot nézet a foglalási napló alapján — szűrj és csoportosíts tetszés szerint.</p>

      <Card className="p-4 mb-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <div><Label className="text-xs">Tól</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">Ig</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div>
          <Label className="text-xs">Alkalmazott</Label>
          <Select value={staffId || "all"} onValueChange={v => setStaffId(v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Mind" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Mind</SelectItem>
              {staffList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.display_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Szolgáltatás</Label>
          <Select value={serviceId || "all"} onValueChange={v => setServiceId(v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Mind" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Mind</SelectItem>
              {serviceList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={onlyPrepaid} onCheckedChange={(c) => setOnlyPrepaid(c === true)} /> Csak előre fizetett</label>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={onlyNew} onCheckedChange={(c) => setOnlyNew(c === true)} /> Csak új vendégek</label>
        <div>
          <Label className="text-xs">Sor (csoportosítás)</Label>
          <Select value={rowKey} onValueChange={(v) => setRowKey(v as GroupKey)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="staff">Alkalmazott</SelectItem>
              <SelectItem value="service">Szolgáltatás</SelectItem>
              <SelectItem value="newReturning">Új / visszatérő</SelectItem>
              <SelectItem value="week">Hét</SelectItem>
              <SelectItem value="month">Hónap</SelectItem>
              <SelectItem value="none">Nincs</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Oszlop (csoportosítás)</Label>
          <Select value={colKey} onValueChange={(v) => setColKey(v as GroupKey)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="staff">Alkalmazott</SelectItem>
              <SelectItem value="service">Szolgáltatás</SelectItem>
              <SelectItem value="newReturning">Új / visszatérő</SelectItem>
              <SelectItem value="week">Hét</SelectItem>
              <SelectItem value="month">Hónap</SelectItem>
              <SelectItem value="none">Nincs</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="p-4"><div className="text-xs text-muted-foreground">Összes foglalás</div><div className="text-2xl font-bold">{pivot.totals.totalCount}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Összes bevétel</div><div className="text-2xl font-bold">{pivot.totals.totalRevenue.toLocaleString("hu-HU")} Ft</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Új vendégek</div><div className="text-2xl font-bold">{pivot.totals.newCount}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Előre fizetett</div><div className="text-2xl font-bold">{pivot.totals.prepaidCount}</div></Card>
      </div>

      <Card className="p-4 overflow-x-auto">
        {isLoading ? <p className="text-muted-foreground">Betöltés…</p> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2 font-semibold">{rowKey} \ {colKey}</th>
                {pivot.colKeys.map(c => <th key={c} className="text-right p-2 font-semibold">{c}</th>)}
                <th className="text-right p-2 font-semibold border-l">Összesen</th>
              </tr>
            </thead>
            <tbody>
              {pivot.rowKeys.map(r => {
                let rowSum = 0;
                let rowRev = 0;
                return (
                  <tr key={r} className="border-b hover:bg-muted/50">
                    <td className="p-2 font-medium">{r}</td>
                    {pivot.colKeys.map(c => {
                      const cell = pivot.cells.get(`${r}||${c}`);
                      const cnt = cell?.count ?? 0;
                      rowSum += cnt;
                      rowRev += cell?.revenue ?? 0;
                      return (
                        <td key={c} className="p-2 text-right">
                          {cnt > 0 ? (
                            <div>
                              <div>{cnt}</div>
                              <div className="text-xs text-muted-foreground">{Math.round(cell!.revenue).toLocaleString("hu-HU")} Ft</div>
                            </div>
                          ) : "–"}
                        </td>
                      );
                    })}
                    <td className="p-2 text-right border-l font-semibold">
                      <div>{rowSum}</div>
                      <div className="text-xs text-muted-foreground">{Math.round(rowRev).toLocaleString("hu-HU")} Ft</div>
                    </td>
                  </tr>
                );
              })}
              {pivot.rowKeys.length === 0 && (
                <tr><td colSpan={pivot.colKeys.length + 2} className="p-4 text-center text-muted-foreground">Nincs adat a megadott szűrőkre.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
