import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  exportServicesXlsx, exportStaffXlsx, exportResourcesXlsx, exportBookingsXlsx,
  importServicesXlsx, importStaffXlsx, importResourcesXlsx,
} from "@/lib/exports.functions";

export const Route = createFileRoute("/dashboard/exports")({
  head: () => ({ meta: [{ title: "Excel export / Import" }] }),
  component: ExportsPage,
});

function downloadBase64Xlsx(base64: string, filename: string) {
  const binStr = atob(base64);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function ImportButton({ onPick, busy }: { onPick: (f: File) => void; busy: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          if (ref.current) ref.current.value = "";
        }}
      />
      <Button variant="outline" disabled={busy} onClick={() => ref.current?.click()}>
        <Upload className="w-4 h-4 mr-2" />{busy ? "..." : "Importálás"}
      </Button>
    </>
  );
}

function ExportsPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];

  const expServices = useServerFn(exportServicesXlsx);
  const expStaff = useServerFn(exportStaffXlsx);
  const expRes = useServerFn(exportResourcesXlsx);
  const expBookings = useServerFn(exportBookingsXlsx);
  const impServices = useServerFn(importServicesXlsx);
  const impStaff = useServerFn(importStaffXlsx);
  const impRes = useServerFn(importResourcesXlsx);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  if (!orgId) return <p className="text-muted-foreground">Először rendelj magadhoz egy szervezetet.</p>;

  async function run(kind: string, fn: () => Promise<{ base64: string; filename: string }>) {
    setBusy(kind);
    try {
      const res = await fn();
      downloadBase64Xlsx(res.base64, res.filename);
      toast.success("Export letöltve");
    } catch (e: any) {
      toast.error(e.message ?? "Export sikertelen");
    } finally {
      setBusy(null);
    }
  }

  async function runImport(kind: string, file: File, fn: (b64: string) => Promise<{ created: number; updated: number; skipped: number; total: number }>) {
    setBusy(kind);
    try {
      const b64 = await fileToBase64(file);
      const r = await fn(b64);
      toast.success(`Import kész — ${r.created} új, ${r.updated} frissítve, ${r.skipped} kihagyva (${r.total} sor)`);
    } catch (e: any) {
      toast.error(e.message ?? "Import sikertelen");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold mb-2 flex items-center gap-2"><FileSpreadsheet className="w-7 h-7" /> Excel export / Import</h1>
      <p className="text-muted-foreground mb-6">Töltsd le vagy olvasd be az üzleted adatait .xlsx formátumban. Az import a Név oszlop alapján egyezteti és frissíti / létrehozza az elemeket.</p>

      <div className="grid gap-3">
        <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Szolgáltatás lista</div>
            <div className="text-sm text-muted-foreground">Szolgáltatások, munkatársak, erőforrások, címkék.</div>
          </div>
          <div className="flex gap-2">
            <ImportButton busy={busy === "imp-services"} onPick={(f) => runImport("imp-services", f, (b64) => impServices({ data: { organizationId: orgId, base64: b64 } }))} />
            <Button onClick={() => run("services", () => expServices({ data: { organizationId: orgId } }))} disabled={busy === "services"}>
              <Download className="w-4 h-4 mr-2" />{busy === "services" ? "..." : "Letöltés"}
            </Button>
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Alkalmazotti lista</div>
            <div className="text-sm text-muted-foreground">Munkatársak, heti munkaidő, szolgáltatások, erőforrások.</div>
          </div>
          <div className="flex gap-2">
            <ImportButton busy={busy === "imp-staff"} onPick={(f) => runImport("imp-staff", f, (b64) => impStaff({ data: { organizationId: orgId, base64: b64 } }))} />
            <Button onClick={() => run("staff", () => expStaff({ data: { organizationId: orgId } }))} disabled={busy === "staff"}>
              <Download className="w-4 h-4 mr-2" />{busy === "staff" ? "..." : "Letöltés"}
            </Button>
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Erőforrás lista</div>
            <div className="text-sm text-muted-foreground">Termek, eszközök, kapcsolt szolgáltatások és munkatársak.</div>
          </div>
          <div className="flex gap-2">
            <ImportButton busy={busy === "imp-res"} onPick={(f) => runImport("imp-res", f, (b64) => impRes({ data: { organizationId: orgId, base64: b64 } }))} />
            <Button onClick={() => run("resources", () => expRes({ data: { organizationId: orgId } }))} disabled={busy === "resources"}>
              <Download className="w-4 h-4 mr-2" />{busy === "resources" ? "..." : "Letöltés"}
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <div className="font-semibold mb-1">Foglalási napló</div>
          <div className="text-sm text-muted-foreground mb-3">
            Minden foglalás strukturáltan: vendég adatai, új vendég jelölés, szolgáltatás, ár, kezelő, fizetés.
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3 max-w-md">
            <div><Label className="text-xs">Tól (opcionális)</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><Label className="text-xs">Ig (opcionális)</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          </div>
          <Button onClick={() => run("bookings", () => expBookings({ data: {
            organizationId: orgId,
            fromISO: from ? new Date(from).toISOString() : undefined,
            toISO: to ? new Date(to + "T23:59:59").toISOString() : undefined,
          } }))} disabled={busy === "bookings"}>
            <Download className="w-4 h-4 mr-2" />{busy === "bookings" ? "..." : "Foglalások letöltése"}
          </Button>
        </Card>
      </div>
    </div>
  );
}
