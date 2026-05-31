import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X, GripHorizontal, ExternalLink } from "lucide-react";

export type ConflictItem = {
  kind: "staff_overlap" | "capacity" | "out_of_hours" | "missing_assignment" | "other";
  message: string;
  bookingId?: string;
  when?: string; // ISO
  who?: string;
  what?: string;
  /** Opcionális override: hova mutasson a link az adott elemnél. */
  href?: string;
  /** Opcionális override: a link szövege. */
  linkLabel?: string;
};

const KIND_LABEL: Record<ConflictItem["kind"], string> = {
  staff_overlap: "Munkatárs-ütközés",
  capacity: "Erőforrás-kapacitás",
  out_of_hours: "Munkaidőn kívül",
  missing_assignment: "Hiányzó hozzárendelés",
  other: "Figyelmeztetés",
};

function defaultLink(c: ConflictItem): { href: string; label: string } | null {
  if (c.href) return { href: c.href, label: c.linkLabel ?? "Megnyitás" };
  // Naptáron belül a dátum a `when`-ből nyerhető — query param a naptárhoz.
  const dateParam = c.when ? `?date=${c.when.slice(0, 10)}` : "";
  switch (c.kind) {
    case "staff_overlap":
    case "capacity":
    case "out_of_hours":
      return { href: `/dashboard/calendar${dateParam}`, label: "Ugrás a naptárhoz" };
    case "missing_assignment":
      return { href: `/dashboard/resources`, label: "Erőforrás-hozzárendelések" };
    default:
      return c.bookingId
        ? { href: `/dashboard/calendar${dateParam}`, label: "Ugrás a naptárhoz" }
        : null;
  }
}

// =========================================================================
// Module-level store — dialogok globálisan élnek (nem tűnnek el navigáláskor)
// =========================================================================

export type ConflictDialogConfig = {
  conflicts: ConflictItem[];
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  showConfirm?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
};

type Entry = {
  id: string;
  config: ConflictDialogConfig;
  /** Igaz, ha a regisztráló komponens már unmountolt — ilyenkor a Mégis mentem nem elérhető. */
  detached: boolean;
};

let entries: Entry[] = [];
const subs = new Set<(e: Entry[]) => void>();
function notify() { subs.forEach((f) => f(entries)); }
function subscribe(cb: (e: Entry[]) => void) {
  subs.add(cb);
  cb(entries);
  return () => { subs.delete(cb); };
}

/** Imperatív API — mutat egy konfliktus-panel; visszaad egy {update, dismiss, detach}-et. */
export function showConflicts(config: ConflictDialogConfig) {
  const id = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  entries = [...entries, { id, config, detached: false }];
  notify();
  return {
    update(next: Partial<ConflictDialogConfig>) {
      entries = entries.map((e) => e.id === id ? { ...e, config: { ...e.config, ...next } } : e);
      notify();
    },
    detach() {
      entries = entries.map((e) => e.id === id ? { ...e, detached: true } : e);
      notify();
    },
    dismiss() {
      entries = entries.filter((e) => e.id !== id);
      notify();
    },
  };
}

function removeEntry(id: string) {
  entries = entries.filter((e) => e.id !== id);
  notify();
}

// =========================================================================
// Visual panel — non-modal, draggable, csak X-szel zárható
// =========================================================================

function ConflictPanel({ entry, index }: { entry: Entry; index: number }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const rect = target.parentElement!.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPos({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  const { config, detached, id } = entry;
  const close = () => {
    config.onCancel?.();
    removeEntry(id);
  };
  const confirm = () => {
    config.onConfirm?.();
    removeEntry(id);
  };

  // Alapértelmezett pozíció: jobb-felső, eltolva más paneleknek
  const offset = index * 24;
  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { right: 24 + offset, top: 80 + offset };

  return (
    <div
      role="dialog"
      aria-modal="false"
      className="pointer-events-auto fixed z-[60] w-[min(92vw,32rem)] rounded-lg border border-destructive/30 bg-background shadow-2xl"
      style={style}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex items-center gap-2 cursor-move select-none rounded-t-lg border-b bg-destructive/10 px-3 py-2"
      >
        <GripHorizontal className="w-4 h-4 text-destructive/70 shrink-0" />
        <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
        <div className="font-semibold text-destructive text-sm flex-1 truncate">
          {config.title ?? "Ütközés észlelve"}
        </div>
        <button
          type="button"
          onClick={close}
          className="rounded-sm p-1 hover:bg-destructive/20 cursor-pointer"
          aria-label="Bezárás"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3">
        {config.description && (
          <p className="text-sm text-muted-foreground mb-2">{config.description}</p>
        )}
        <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
          {config.conflicts.map((c, i) => {
            const link = defaultLink(c);
            return (
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
                {link && (
                  <div className="mt-1.5">
                    <Link
                      to={link.href}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" /> {link.label}
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
          {config.conflicts.length === 0 && (
            <li className="text-sm text-muted-foreground">Nincs konkrét részlet.</li>
          )}
        </ul>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" size="sm" onClick={close}>
            {config.cancelLabel ?? "Mégse"}
          </Button>
          {(config.showConfirm ?? true) && config.onConfirm && !detached && (
            <Button variant="destructive" size="sm" onClick={confirm}>
              {config.confirmLabel ?? "Mégis mentem"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Globális host — egyszer mountolva a dashboard layoutban. */
export function ConflictDialogHost() {
  const [list, setList] = useState<Entry[]>(entries);
  useEffect(() => subscribe(setList), []);
  if (typeof document === "undefined") return null;
  if (list.length === 0) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60]">
      {list.map((e, i) => <ConflictPanel key={e.id} entry={e} index={i} />)}
    </div>,
    document.body,
  );
}

// =========================================================================
// Backward-compatible declaratív komponens — props alapján regisztrál a store-ba
// =========================================================================

export function ConflictDialog({
  open,
  onOpenChange,
  conflicts,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  showConfirm = true,
  pending: _pending,
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
  const handleRef = useRef<ReturnType<typeof showConflicts> | null>(null);
  const closingRef = useRef(false);

  const wrappedCancel = useCallback(() => {
    closingRef.current = true;
    onCancel?.();
    onOpenChange(false);
  }, [onCancel, onOpenChange]);

  const wrappedConfirm = useCallback(() => {
    closingRef.current = true;
    onConfirm?.();
    onOpenChange(false);
  }, [onConfirm, onOpenChange]);

  useEffect(() => {
    if (open && !handleRef.current) {
      closingRef.current = false;
      handleRef.current = showConflicts({
        conflicts, title, description, confirmLabel, cancelLabel,
        showConfirm, onConfirm: wrappedConfirm, onCancel: wrappedCancel,
      });
    } else if (!open && handleRef.current) {
      handleRef.current.dismiss();
      handleRef.current = null;
    } else if (open && handleRef.current) {
      handleRef.current.update({
        conflicts, title, description, confirmLabel, cancelLabel,
        showConfirm, onConfirm: wrappedConfirm, onCancel: wrappedCancel,
      });
    }
  }, [open, conflicts, title, description, confirmLabel, cancelLabel, showConfirm, wrappedConfirm, wrappedCancel]);

  useEffect(() => () => {
    // Unmount: ha még nyitva van, hagyjuk élni a panelt (linkre kattintás), de jelöljük detached-nek.
    if (handleRef.current && !closingRef.current) {
      handleRef.current.detach();
      handleRef.current = null;
    }
  }, []);

  return null;
}

/** Segéd: szerver `CONFLICTS:` hibából ConflictItem[]-et csinál. */
export function parseConflictsFromError(err: unknown): ConflictItem[] | null {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (!msg.startsWith("CONFLICTS:")) return null;
  const payload = msg.replace("CONFLICTS:", "").trim();
  try {
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed)) return parsed as ConflictItem[];
  } catch {
    /* ignore */
  }
  return payload
    .split(" | ")
    .filter(Boolean)
    .map((m) => ({ kind: "other" as const, message: m }));
}

// cn import-ot megőrizzük a jövőbeni stílus-finomításhoz
void cn;
