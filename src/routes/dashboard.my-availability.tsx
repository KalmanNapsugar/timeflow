import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, CalendarClock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/my-availability")({
  head: () => ({ meta: [{ title: "Saját rendelkezésre állásom" }] }),
  component: MyAvailabilityPage,
});

type WindowEntry = { start: string; end: string };

function MyAvailabilityPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [windows, setWindows] = useState<WindowEntry[]>([]);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-staff-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("staff_profiles")
        .select("id, display_name, organization_id, availability_windows_json")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (!profile) return;
    const arr = Array.isArray(profile.availability_windows_json) ? profile.availability_windows_json as any[] : [];
    setWindows(arr
      .filter((w: any) => w && typeof w.start === "string" && typeof w.end === "string")
      .map((w: any) => ({ start: new Date(w.start).toISOString().slice(0, 16), end: new Date(w.end).toISOString().slice(0, 16) })));
  }, [profile?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Nincs munkatárs profilod ehhez az üzlethez.");
      const payload = windows
        .filter(w => w.start && w.end)
        .map(w => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() }));
      const { error } = await supabase.from("staff_profiles")
        .update({ availability_windows_json: payload })
        .eq("id", profile.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mentve"); qc.invalidateQueries({ queryKey: ["my-staff-profile", user?.id] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <p>Betöltés…</p>;
  if (!profile) return (
    <Card className="p-6">
      <h1 className="text-2xl font-bold mb-2 flex items-center gap-2"><CalendarClock className="w-6 h-6" /> Saját rendelkezésre állásom</h1>
      <p className="text-muted-foreground">Nincs munkatárs profilod ehhez az üzlethez. Kérd meg az üzlet tulajdonosát, hogy hozzon létre egy profilt számodra, vagy lépj be alkalmazottként.</p>
    </Card>
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold mb-2 flex items-center gap-2"><CalendarClock className="w-7 h-7" /> Saját rendelkezésre állásom</h1>
      <p className="text-muted-foreground mb-6">
        Itt egyedi időablakokat adhatsz meg, amikor elérhető vagy (pl. nyaralás visszatérése után). <br />
        <strong>Ha üres a lista → csak a heti munkaidőd számít.</strong> Ha van legalább egy ablak → CSAK ezeken belül lehet hozzád foglalni.
      </p>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Időablakok ({profile.display_name})</div>
          <Button size="sm" onClick={() => setWindows([...windows, { start: "", end: "" }])}>
            <Plus className="w-4 h-4 mr-1" /> Új ablak
          </Button>
        </div>
        {windows.length === 0 && <p className="text-sm text-muted-foreground">Nincs egyedi időablak — a heti munkaidőd szerint vagy elérhető.</p>}
        {windows.map((w, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2 items-end">
            <div><Label className="text-xs">Kezdés</Label><Input type="datetime-local" value={w.start} onChange={(e) => {
              const nw = [...windows]; nw[i] = { ...nw[i], start: e.target.value }; setWindows(nw);
            }} /></div>
            <div><Label className="text-xs">Vége</Label><Input type="datetime-local" value={w.end} onChange={(e) => {
              const nw = [...windows]; nw[i] = { ...nw[i], end: e.target.value }; setWindows(nw);
            }} /></div>
            <Button variant="ghost" size="icon" onClick={() => setWindows(windows.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
        <Button className="mt-3" onClick={() => save.mutate()} disabled={save.isPending}>Mentés</Button>
      </Card>
    </div>
  );
}
