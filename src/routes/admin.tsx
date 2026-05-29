import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { listUsers, setUserRole, deleteUserAccount, upsertRolePermission, deleteRolePermission } from "@/lib/admin.functions";
import { useRoutePermissions, ROLE_LABEL } from "@/lib/permissions";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Trash2, RefreshCw, Plus } from "lucide-react";
import { SiteMap } from "@/components/SiteMap";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin – Felhasználók" }] }),
  component: AdminPage,
});

const ROLES = ["guest", "staff", "owner", "platform_admin"] as const;

function AdminPage() {
  const { user, loading, effectiveRole, realRoles } = useAuth();
  const navigate = useNavigate();
  const fetchUsers = useServerFn(listUsers);
  const setRole = useServerFn(setUserRole);
  const removeUser = useServerFn(deleteUserAccount);
  const [users, setUsers] = useState<Awaited<ReturnType<typeof listUsers>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  async function load() {
    setBusy(true); setErr(null);
    try { setUsers(await fetchUsers()); }
    catch (e: any) { setErr(e.message ?? "Hiba"); }
    finally { setBusy(false); }
  }

  // Csak a valós platform_admin tölthet. Impersonálás esetén is van valós admin role, így OK.
  useEffect(() => { if (user && realRoles.includes("platform_admin")) load(); /* eslint-disable-next-line */ }, [user, realRoles.join(",")]);

  async function toggleRole(uid: string, role: typeof ROLES[number], enabled: boolean) {
    try {
      await setRole({ data: { userId: uid, role, enabled } });
      toast.success("Frissítve");
      await load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function handleDelete(uid: string, email: string) {
    if (!confirm(`Biztosan törlöd: ${email}?`)) return;
    try {
      await removeUser({ data: { userId: uid } });
      toast.success("Törölve");
      await load();
    } catch (e: any) { toast.error(e.message); }
  }

  if (loading) return <div className="p-10">Betöltés…</div>;
  if (!user) return null;

  if (!realRoles.includes("platform_admin")) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md p-6 text-center">
          <h1 className="text-xl font-semibold mb-2">Nincs jogosultságod</h1>
          <p className="text-sm text-muted-foreground mb-4">Ez az oldal csak platform admin felhasználók számára érhető el.</p>
          <Button asChild><Link to="/">Vissza a főoldalra</Link></Button>
        </Card>
      </div>
    );
  }

  const impersonating = effectiveRole !== "platform_admin";

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
              <ArrowLeft className="w-3 h-3" /> Vissza
            </Link>
            <h1 className="text-2xl font-bold">Felhasználók kezelése</h1>
            <p className="text-sm text-muted-foreground">
              Platform admin felület. Az első bejelentkező automatikusan admin lesz, ha még nincs admin a rendszerben.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={busy}>
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /> Frissítés
          </Button>
        </div>

        {err && <Card className="p-4 mb-4 border-destructive text-destructive">{err}</Card>}
        {impersonating && (
          <Card className="p-3 mb-4 text-sm bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900">
            Most <strong>{effectiveRole}</strong> szerepkört impersonálsz — a valós szerepköröd platform admin maradt.
          </Card>
        )}

        <div className="mb-6">
          <SiteMap />
        </div>


        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail / Név</TableHead>
                <TableHead>Megerősítve</TableHead>
                <TableHead>Szervezetek</TableHead>
                {ROLES.map(r => <TableHead key={r} className="text-center">{r}</TableHead>)}
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map(u => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.email}</div>
                    {u.full_name && <div className="text-xs text-muted-foreground">{u.full_name}</div>}
                  </TableCell>
                  <TableCell>
                    {u.confirmed ? <Badge variant="secondary">igen</Badge> : <Badge variant="outline">nem</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {u.orgs.length ? u.orgs.map(o => o.name).join(", ") : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  {ROLES.map(r => (
                    <TableCell key={r} className="text-center">
                      <Checkbox
                        checked={u.roles.includes(r)}
                        onCheckedChange={(v) => toggleRole(u.id, r, !!v)}
                      />
                    </TableCell>
                  ))}
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(u.id, u.email)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {users && users.length === 0 && (
                <TableRow><TableCell colSpan={ROLES.length + 4} className="text-center text-muted-foreground py-8">Nincs felhasználó</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
