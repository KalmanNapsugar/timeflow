import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export type ConflictItem = {
  kind: "staff_overlap" | "capacity" | "out_of_hours" | "missing_assignment" | "other";
  message: string;
  bookingId?: string;
  when?: string; // ISO
  who?: string;
  what?: string;
};

const KIND_LABEL: Record<ConflictItem["kind"], string> = {
  staff_overlap: "Munkatárs-ütközés",
  capacity: "Erőforrás-kapacitás",
  out_of_hours: "Munkaidőn kívül",
  missing_assignment: "Hiányzó hozzárendelés",
  other: "Figyelmeztetés",
};

export function ConflictDialog({
  open,
  onOpenChange,
  conflicts,
  title = "Ütközés észlelve",
  description,
  confirmLabel = "Mégis mentem",
  cancelLabel = "Mégse",
  onConfirm,
  onCancel,
  showConfirm = true,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conflicts: ConflictItem[];
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  showConfirm?: boolean;
  pending?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" /> {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
          {conflicts.map((c, i) => (
            <li
              key={i}
              className="rounded border border-destructive/30 bg-destructive/5 p-2 text-sm"
            >
              <div className="font-medium text-destructive">{KIND_LABEL[c.kind]}</div>
              <div className="text-foreground">{c.message}</div>
              {(c.when || c.who || c.what) && (
                <div className="text-xs text-muted-foreground mt-1">
                  {c.when && <span>{new Date(c.when).toLocaleString("hu-HU")}</span>}
                  {c.who && <span> · {c.who}</span>}
                  {c.what && <span> · {c.what}</span>}
                </div>
              )}
            </li>
          ))}
          {conflicts.length === 0 && (
            <li className="text-sm text-muted-foreground">Nincs konkrét részlet.</li>
          )}
        </ul>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              onCancel?.();
              onOpenChange(false);
            }}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          {showConfirm && onConfirm && (
            <Button variant="destructive" onClick={onConfirm} disabled={pending}>
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Segéd: szerver `CONFLICTS:` hibából ConflictItem[]-et csinál. */
export function parseConflictsFromError(err: unknown): ConflictItem[] | null {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (!msg.startsWith("CONFLICTS:")) return null;
  const payload = msg.replace("CONFLICTS:", "").trim();
  // Próbáljuk JSON-ként
  try {
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed)) return parsed as ConflictItem[];
  } catch {
    /* ignore */
  }
  // Visszaesés: pipe-szeparált szöveg
  return payload
    .split(" | ")
    .filter(Boolean)
    .map((m) => ({ kind: "other" as const, message: m }));
}
