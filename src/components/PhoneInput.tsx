import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

type Country = { code: string; name: string; dial: string };

// Gyakran használt országok — Magyarország alapértelmezett
export const COUNTRIES: Country[] = [
  { code: "HU", name: "Magyarország", dial: "36" },
  { code: "AT", name: "Ausztria", dial: "43" },
  { code: "SK", name: "Szlovákia", dial: "421" },
  { code: "RO", name: "Románia", dial: "40" },
  { code: "DE", name: "Németország", dial: "49" },
  { code: "CZ", name: "Csehország", dial: "420" },
  { code: "PL", name: "Lengyelország", dial: "48" },
  { code: "HR", name: "Horvátország", dial: "385" },
  { code: "SI", name: "Szlovénia", dial: "386" },
  { code: "RS", name: "Szerbia", dial: "381" },
  { code: "UA", name: "Ukrajna", dial: "380" },
  { code: "IT", name: "Olaszország", dial: "39" },
  { code: "FR", name: "Franciaország", dial: "33" },
  { code: "ES", name: "Spanyolország", dial: "34" },
  { code: "NL", name: "Hollandia", dial: "31" },
  { code: "BE", name: "Belgium", dial: "32" },
  { code: "CH", name: "Svájc", dial: "41" },
  { code: "GB", name: "Egyesült Királyság", dial: "44" },
  { code: "IE", name: "Írország", dial: "353" },
  { code: "US", name: "Egyesült Államok", dial: "1" },
];

const DEFAULT_DIAL = "36";

function formatLocal(dial: string, digits: string): string {
  if (!digits) return `+${dial}`;
  if (digits.length <= 2) return `+${dial} ${digits}`;
  return `+${dial} ${digits.slice(0, 2)} ${digits.slice(2)}`;
}

// Bejövő értékből kibontja: melyik ország + helyi számjegyek
export function parsePhone(value: string | null | undefined): { dial: string; local: string } {
  const raw = (value ?? "").trim();
  if (!raw) return { dial: DEFAULT_DIAL, local: "" };
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return { dial: DEFAULT_DIAL, local: "" };
  // Próbáljuk a leghosszabb illeszkedő hívókódot megtalálni
  const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  if (raw.startsWith("+") || raw.startsWith("00")) {
    for (const c of sorted) {
      if (digits.startsWith(c.dial)) {
        return { dial: c.dial, local: digits.slice(c.dial.length) };
      }
    }
  }
  // Magyar belföldi formátum: 06...
  if (digits.startsWith("06")) return { dial: "36", local: digits.slice(2) };
  return { dial: DEFAULT_DIAL, local: digits };
}

export function normalizePhone(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  const { dial, local } = parsePhone(v);
  if (!local) return "";
  return formatLocal(dial, local);
}

export function PhoneInput({
  value,
  onChange,
  placeholder,
  required,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  id?: string;
}) {
  const parsed = useMemo(() => parsePhone(value), [value]);
  const [dial, setDial] = useState(parsed.dial);
  const [local, setLocal] = useState(parsed.local);

  // Külső érték változásra szinkronizálunk (pl. szerkesztés betöltésekor)
  useEffect(() => {
    const p = parsePhone(value);
    setDial(p.dial);
    setLocal(p.local);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(nextDial: string, nextLocal: string) {
    const digits = nextLocal.replace(/[^\d]/g, "");
    onChange(digits ? formatLocal(nextDial, digits) : "");
  }

  return (
    <div className="flex gap-2">
      <select
        className="h-9 w-auto rounded-md border border-input bg-background px-2 text-sm shrink-0"
        value={dial}
        onChange={(e) => {
          setDial(e.target.value);
          emit(e.target.value, local);
        }}
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.dial}>
            {c.name} (+{c.dial})
          </option>
        ))}
      </select>
      <Input
        id={id}
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={placeholder ?? "20 1234567"}
        required={required}
        value={local}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, "");
          setLocal(digits);
          emit(dial, digits);
        }}
        className="flex-1 min-w-0"
      />
    </div>
  );
}
