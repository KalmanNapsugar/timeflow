import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { listUsers, setUserRole, deleteUserAccount, upsertRolePermission, deleteRolePermission } from "@/lib/admin.functions";
import { startImpersonation, listImpersonationLogs } from "@/lib/impersonation.functions";
import { listOrganizationsWithMembers } from "@/lib/staff.functions";
import { archiveOrganization, unarchiveOrganization, deleteOrganization, exportOrganization, importOrganization } from "@/lib/admin-orgs.functions";
import { useRoutePermissions, ROLE_LABEL } from "@/lib/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Trash2, RefreshCw, Plus, Eye, FileClock, Store, Archive, ArchiveRestore, Download, Upload } from "lucide-react";
import { SiteMap } from "@/components/SiteMap";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin – Felhasználók" }] }),
  component: AdminPage,
});

const ROLES = ["guest", "customer", "staff", "owner", "platform_admin"] as const;

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

        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">Felhasználók</TabsTrigger>
            <TabsTrigger value="orgs"><Store className="w-3 h-3 mr-1" />Üzletek</TabsTrigger>
            <TabsTrigger value="permissions">Engedélyek</TabsTrigger>
            <TabsTrigger value="impersonation"><FileClock className="w-3 h-3 mr-1" />Impersonációs napló</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-4">
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail / Név</TableHead>
                    <TableHead>Megerősítve</TableHead>
                    <TableHead>Szervezetek</TableHead>
                    {ROLES.map(r => <TableHead key={r} className="text-center">{r}</TableHead>)}
                    <TableHead className="text-center">Nézet</TableHead>
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
                      <TableCell className="text-center">
                        <ImpersonateButton userId={u.id} email={u.email} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(u.id, u.email)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {users && users.length === 0 && (
                    <TableRow><TableCell colSpan={ROLES.length + 5} className="text-center text-muted-foreground py-8">Nincs felhasználó</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="orgs" className="mt-4">
            <OrgsTab />
          </TabsContent>

          <TabsContent value="permissions" className="mt-4">
            <PermissionsTab />
          </TabsContent>

          <TabsContent value="impersonation" className="mt-4">
            <ImpersonationLogTab users={users ?? []} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function PermissionsTab() {
  const { data: rows, isLoading } = useRoutePermissions();
  const qc = useQueryClient();
  const upsert = useServerFn(upsertRolePermission);
  const remove = useServerFn(deleteRolePermission);
  const [newPath, setNewPath] = useState("");
  const [newLabel, setNewLabel] = useState("");

  function refresh() {
    qc.invalidateQueries({ queryKey: ["role_permissions"] });
    qc.invalidateQueries({ queryKey: ["role_permissions_full"] });
  }

  async function toggle(path: string, label: string, role: typeof ROLES[number], current: string[], enabled: boolean) {
    const next = enabled
      ? Array.from(new Set([...current, role]))
      : current.filter(r => r !== role);
    try {
      await upsert({ data: { route_path: path, label, roles: next as any } });
      toast.success("Frissítve");
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  async function addRow() {
    if (!newPath.startsWith("/")) { toast.error("Az útvonalnak /-rel kell kezdődnie"); return; }
    try {
      await upsert({ data: { route_path: newPath, label: newLabel || newPath, roles: ["platform_admin"] } });
      setNewPath(""); setNewLabel("");
      toast.success("Hozzáadva");
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  async function del(path: string) {
    if (!confirm(`Törlöd a(z) ${path} engedélysort? Ezután az alapértelmezés (ha van) lép életbe.`)) return;
    try { await remove({ data: { route_path: path } }); toast.success("Törölve"); refresh(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground mb-4">
        Pipáld be, mely szerepkörök férhetnek hozzá az adott útvonalhoz. A változások azonnal érvényesek a navigációra és az oldalak gating-jére.
      </p>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Útvonal</TableHead>
              <TableHead>Címke</TableHead>
              {ROLES.map(r => <TableHead key={r} className="text-center">{ROLE_LABEL[r]}</TableHead>)}
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={ROLES.length + 3} className="py-6 text-center text-muted-foreground">Betöltés…</TableCell></TableRow>}
            {rows?.map(row => (
              <TableRow key={row.route_path}>
                <TableCell className="font-mono text-xs">{row.route_path}</TableCell>
                <TableCell className="text-sm">{row.label}</TableCell>
                {ROLES.map(r => (
                  <TableCell key={r} className="text-center">
                    <Checkbox
                      checked={row.roles.includes(r)}
                      disabled={row.route_path === "/admin" && r === "platform_admin"}
                      onCheckedChange={(v) => toggle(row.route_path, row.label, r, row.roles, !!v)}
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <Button variant="ghost" size="icon" disabled={row.route_path === "/admin"} onClick={() => del(row.route_path)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-6 border-t pt-4">
        <div className="text-sm font-medium mb-2">Új útvonal engedély</div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs text-muted-foreground">Útvonal (/...)</label>
            <Input value={newPath} onChange={e => setNewPath(e.target.value)} placeholder="/dashboard/uj-oldal" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs text-muted-foreground">Címke</label>
            <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Beszédes név" />
          </div>
          <Button onClick={addRow}><Plus className="w-4 h-4 mr-2" />Hozzáadás</Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Új sor alapból csak platform admin szerepkört kap — utána a pipákkal állíthatod be.
        </p>
      </div>
    </Card>
  );
}

const SS_KEY = "ifx_impersonation_session";

function ImpersonateButton({ userId, email }: { userId: string; email: string }) {
  const start = useServerFn(startImpersonation);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function begin() {
    if (reason.trim().length < 5) { toast.error("Az indok min. 5 karakter"); return; }
    setBusy(true);
    try {
      const { sessionId } = await start({ data: { targetUserId: userId, reason: reason.trim() } });
      sessionStorage.setItem(SS_KEY, sessionId);
      setOpen(false);
      navigate({ to: "/admin/view/$userId", params: { userId } });
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} title="Megnézem mit lát ez a felhasználó">
        <Eye className="w-4 h-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Olvasási nézet indítása</DialogTitle>
            <DialogDescription>
              Megnyitod <strong>{email}</strong> felhasználó nézetét olvasási módban. Semmilyen módosítást nem fogsz tudni végrehajtani.
              Az indok és minden megtekintett oldal naplózásra kerül (GDPR célhozkötöttség).
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Indok (kötelező)</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="pl. Ügyfélbejelentés #1234 — foglalás-eltűnés vizsgálata" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Mégse</Button>
            <Button onClick={begin} disabled={busy}>Indítás</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImpersonationLogTab({ users }: { users: Array<{ id: string; email: string }> }) {
  const fetchLogs = useServerFn(listImpersonationLogs);
  const { data: logs, isLoading } = useQuery({
    queryKey: ["impersonation_logs"],
    queryFn: () => fetchLogs(),
  });
  const emailOf = (id: string) => users.find(u => u.id === id)?.email ?? id.slice(0, 8);

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Admin</TableHead>
            <TableHead>Megtekintett felhasználó</TableHead>
            <TableHead>Indok</TableHead>
            <TableHead>Kezdés</TableHead>
            <TableHead>Befejezés</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Betöltés…</TableCell></TableRow>}
          {logs?.map(l => (
            <TableRow key={l.id}>
              <TableCell className="text-xs">{emailOf(l.admin_user_id)}</TableCell>
              <TableCell className="text-xs">{emailOf(l.target_user_id)}</TableCell>
              <TableCell className="text-sm">{l.reason}</TableCell>
              <TableCell className="text-xs">{new Date(l.started_at).toLocaleString("hu-HU")}</TableCell>
              <TableCell className="text-xs">{l.ended_at ? new Date(l.ended_at).toLocaleString("hu-HU") : <Badge variant="outline">folyamatban</Badge>}</TableCell>
            </TableRow>
          ))}
          {logs && logs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Nincs naplóbejegyzés</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}

function OrgsTab() {
  const fetchOrgs = useServerFn(listOrganizationsWithMembers);
  const archive = useServerFn(archiveOrganization);
  const unarchive = useServerFn(unarchiveOrganization);
  const remove = useServerFn(deleteOrganization);
  const exportFn = useServerFn(exportOrganization);
  const importFn = useServerFn(importOrganization);
  const qc = useQueryClient();
  const { data: orgs, isLoading } = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: () => fetchOrgs(),
  });

  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  function refresh() { qc.invalidateQueries({ queryKey: ["admin-orgs"] }); }

  async function doArchive(id: string) {
    setBusyId(id);
    try { await archive({ data: { orgId: id } }); toast.success("Archiválva"); refresh(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusyId(null); }
  }

  async function doUnarchive(id: string) {
    setBusyId(id);
    try { await unarchive({ data: { orgId: id } }); toast.success("Visszaállítva"); refresh(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusyId(null); }
  }

  async function doExport(id: string, name: string) {
    setBusyId(id);
    try {
      const payload = await exportFn({ data: { orgId: id } });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = name.replace(/[^a-zA-Z0-9-_]+/g, "_");
      a.href = url; a.download = `${safeName}-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Letöltés elindítva");
    } catch (e: any) { toast.error(e.message); }
    finally { setBusyId(null); }
  }

  async function doDelete() {
    if (!confirmDel) return;
    setBusyId(confirmDel.id);
    try {
      await remove({ data: { orgId: confirmDel.id, confirmName: confirmInput } });
      toast.success("Törölve");
      setConfirmDel(null); setConfirmInput("");
      refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusyId(null); }
  }

  async function handleImport(e: import("react").ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await importFn({ data: json });
      if (res.warnings?.length) toast.warning(`Importálva, de figyelmeztetésekkel: ${res.warnings.length} db`);
      else toast.success("Importálva archivált állapotban");
      refresh();
    } catch (err: any) {
      toast.error(err.message ?? "Importálás sikertelen");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (isLoading) return <Card className="p-6 text-center text-muted-foreground">Betöltés…</Card>;

  return (
    <div className="space-y-3">
      {orgs?.map(o => {
        const archived = !!o.archived_at;
        return (
          <Card key={o.id} className={`p-4 ${archived ? "bg-muted/50 border-dashed" : ""}`}>
            <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
              <div>
                <div className="font-semibold flex items-center gap-2">
                  {o.name}
                  {archived && <Badge variant="outline" className="text-xs">Archivált</Badge>}
                </div>
                <div className="text-xs text-muted-foreground font-mono">/{o.slug}</div>
                {archived && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Archiválva: {new Date(o.archived_at!).toLocaleString("hu-HU")}
                  </div>
                )}
              </div>
              <div className="text-sm text-right">
                <div className="text-xs text-muted-foreground">Tulajdonos</div>
                <div>{o.owner_email ?? <span className="text-muted-foreground italic">nincs tulajdonos</span>}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {archived ? (
                <Button size="sm" variant="outline" disabled={busyId === o.id} onClick={() => doUnarchive(o.id)}>
                  <ArchiveRestore className="w-3 h-3 mr-1" /> Visszaállítás
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled={busyId === o.id} onClick={() => doArchive(o.id)}>
                  <Archive className="w-3 h-3 mr-1" /> Archiválás
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={busyId === o.id} onClick={() => doExport(o.id, o.slug)}>
                <Download className="w-3 h-3 mr-1" /> Mentés (JSON)
              </Button>
              <Button size="sm" variant="destructive" disabled={busyId === o.id}
                onClick={() => { setConfirmDel({ id: o.id, name: o.name }); setConfirmInput(""); }}>
                <Trash2 className="w-3 h-3 mr-1" /> Törlés
              </Button>
            </div>

            <div className="border-t pt-3">
              <div className="text-xs text-muted-foreground mb-2">Felhasználók ({o.members.length})</div>
              {o.members.length === 0 && <div className="text-sm text-muted-foreground">Csak a tulajdonos.</div>}
              <div className="space-y-1">
                {o.members.map(m => (
                  <div key={m.user_id} className="flex items-center justify-between text-sm">
                    <span>{m.email}</span>
                    <span><Badge variant="outline">{m.role}</Badge> {!m.active && <Badge variant="outline" className="ml-1">inaktív</Badge>}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        );
      })}
      {orgs && orgs.length === 0 && <Card className="p-6 text-center text-muted-foreground">Nincs üzlet</Card>}

      <Card className="p-4 border-dashed">
        <div className="text-sm font-medium mb-1">Üzlet visszatöltése fájlból</div>
        <p className="text-xs text-muted-foreground mb-3">
          Egy korábban exportált JSON fájlt tölthetsz vissza. Az üzlet és minden hozzá tartozó adat
          ugyanazokkal az ID-kkal jön létre, <strong>archivált állapotban</strong>. Ezt követően kézzel
          tudod visszaállítani éles üzemmódba a fenti "Visszaállítás" gombbal.
        </p>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleImport} className="hidden" />
          <Button size="sm" variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" /> {importing ? "Feltöltés…" : "Fájl kiválasztása"}
          </Button>
        </div>
      </Card>

      <Dialog open={!!confirmDel} onOpenChange={(v) => { if (!v) { setConfirmDel(null); setConfirmInput(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Üzlet végleges törlése</DialogTitle>
            <DialogDescription>
              Ez a művelet <strong>visszavonhatatlan</strong>. Minden hozzá tartozó adat (foglalások,
              szolgáltatások, alkalmazottak, ügyfelek, fizetések, stb.) is törlődik.
              <br /><br />
              A megerősítéshez gépeld be az üzlet pontos nevét: <strong>{confirmDel?.name}</strong>
            </DialogDescription>
          </DialogHeader>
          <Input value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmDel?.name} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmDel(null); setConfirmInput(""); }}>Mégse</Button>
            <Button variant="destructive" disabled={confirmInput.trim() !== confirmDel?.name || busyId === confirmDel?.id} onClick={doDelete}>
              Végleges törlés
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


