import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { viewUserSnapshot, endImpersonation, logImpersonationView } from "@/lib/impersonation.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, ArrowLeft, Calendar, Store, User as UserIcon, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/admin/view/$userId")({
  head: () => ({ meta: [{ title: "Felhasználói nézet (olvasás)" }] }),
  component: ViewUserPage,
});

const SS_KEY = "ifx_impersonation_session";

function ViewUserPage() {
  const { userId } = Route.useParams();
  const { realRoles, loading } = useAuth();
  const navigate = useNavigate();
  const fetchSnap = useServerFn(viewUserSnapshot);
  const endFn = useServerFn(endImpersonation);
  const logFn = useServerFn(logImpersonationView);

  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const s = sessionStorage.getItem(SS_KEY);
      if (s) setSessionId(s);
    }
  }, []);

  useEffect(() => {
    if (sessionId) logFn({ data: { sessionId, route: `/admin/view/${userId}` } }).catch(() => {});
  }, [sessionId, userId]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["user_snapshot", userId],
    queryFn: () => fetchSnap({ data: { targetUserId: userId } }),
    enabled: !loading && realRoles.includes("platform_admin"),
  });

  async function handleEnd() {
    if (sessionId) {
      try { await endFn({ data: { sessionId } }); } catch {}
      sessionStorage.removeItem(SS_KEY);
    }
    navigate({ to: "/admin" });
  }

  if (loading) return <div className="p-10">Betöltés…</div>;
  if (!realRoles.includes("platform_admin")) {
    return <div className="p-10 text-center">Csak platform admin férhet hozzá.</div>;
  }
  if (error) return <div className="p-10 text-destructive">{(error as any).message}</div>;
  if (isLoading || !data) return <div className="p-10">Betöltés…</div>;

  return (
    <div className="min-h-screen">
      {/* Banner */}
      <div className="bg-amber-500 text-amber-950 px-4 py-3 flex items-center justify-between gap-3 sticky top-0 z-30 shadow">
        <div className="flex items-center gap-2 text-sm">
          <Eye className="w-4 h-4" />
          <strong>OLVASÁSI MÓD</strong>
          <span>— {data.email ?? userId} adatait nézed. Írási műveletek tiltva.</span>
        </div>
        <Button size="sm" variant="outline" className="bg-white" onClick={handleEnd}>
          Kilépés
        </Button>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4">
          <ArrowLeft className="w-3 h-3" /> Vissza az admin felületre
        </Link>

        <Card className="p-5 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <UserIcon className="w-4 h-4" />
            <h1 className="text-xl font-semibold">{data.profile?.full_name ?? data.email}</h1>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <div>E-mail: {data.email}</div>
            {data.profile?.phone && <div>Telefon: {data.profile.phone}</div>}
            {data.created_at && <div>Regisztráció: {new Date(data.created_at).toLocaleString("hu-HU")}</div>}
          </div>
        </Card>

        <Card className="p-5 mb-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Store className="w-4 h-4" /> Üzletei ({data.organizations.length})</h2>
          {data.organizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nincs saját üzlete.</p>
          ) : (
            <ul className="space-y-2">
              {data.organizations.map((o: any) => (
                <li key={o.id} className="text-sm flex items-center justify-between border-b pb-2 last:border-0">
                  <span>{o.name}</span>
                  <Badge variant="outline">{o.slug}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Calendar className="w-4 h-4" /> Foglalásai ({data.bookings.length})</h2>
          {data.bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nincsenek foglalásai.</p>
          ) : (
            <ul className="space-y-2">
              {data.bookings.map((b: any) => (
                <li key={b.id} className="text-sm flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <div>{new Date(b.start_at).toLocaleString("hu-HU")}</div>
                    <div className="text-xs text-muted-foreground">{b.price_total} Ft</div>
                  </div>
                  <Badge variant={b.status === "confirmed" ? "secondary" : "outline"}>{b.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="mt-6 p-4 border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-xs text-muted-foreground rounded flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong>GDPR emlékeztető:</strong> Ez a nézet csak támogatási, hibajavítási és kifejezett ügyfélkérés esetén használható.
            Minden megtekintés naplózásra kerül (impersonációs napló). Az indokot rögzítettük: korlátozott idejű olvasási hozzáférés.
          </div>
        </div>
      </div>
    </div>
  );
}
