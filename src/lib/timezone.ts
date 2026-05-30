/**
 * Időzóna- és DST-tudatos segédfüggvények.
 * A heti minták és időablakok az üzlet (organization) IANA időzónájában értelmeződnek,
 * így nyári/téli időszámítás-váltáskor is helyesen működnek.
 */

/**
 * Feloldja az üzlet effektív időzónáját.
 * Ha a DST-követés ki van kapcsolva, a zóna téli (standard) eltolódását
 * használjuk egész éven át (Etc/GMT±N formában — egész órás eltolódás).
 */
export function resolveBusinessTz(tz: string, dstEnabled: boolean): string {
  if (dstEnabled) return tz || "Europe/Budapest";
  try {
    // Január közepén a legtöbb zóna standard (téli) időben van
    const jan = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 15, 12));
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(jan)) if (p.type !== "literal") parts[p.type] = p.value;
    const localHour = Number(parts.hour) + Number(parts.minute) / 60;
    const utcHour = 12;
    const offsetH = Math.round(localHour - utcHour); // pozitív, ha a zóna UTC-től keletre van
    // Etc/GMT jelzése fordított: Etc/GMT-1 = UTC+1
    return `Etc/GMT${offsetH >= 0 ? "-" : "+"}${Math.abs(offsetH)}`;
  } catch {
    return tz || "Europe/Budapest";
  }
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const WD_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export interface ZonedParts {
  year: number; month: number; day: number;
  hour: number; minute: number; weekday: number;
}

/** Egy UTC pillanat → részek a megadott IANA időzónában. */
export function getZonedParts(date: Date, tz: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // edge case Node hour12=false
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    weekday: WD_MAP[parts.weekday] ?? 0,
  };
}

/** Az adott UTC pillanat eltolása a tz-hez képest, ms-ben (local = utc + offset). */
function tzOffsetMs(date: Date, tz: string): number {
  const p = getZonedParts(date, tz);
  const asIfUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, date.getUTCSeconds(), date.getUTCMilliseconds());
  return asIfUTC - date.getTime();
}

/**
 * A megadott időzónában értelmezett "fali óra" idő → valódi UTC Date.
 * Helyesen kezeli a nyári időszámítás-váltást két iterációval.
 */
export function zonedTimeToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number,
  tz: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset1 = tzOffsetMs(guess, tz);
  const adjusted = new Date(guess.getTime() - offset1);
  const offset2 = tzOffsetMs(adjusted, tz);
  // Második iteráció a DST-átmenet körüli pontosságért
  if (offset1 !== offset2) {
    return new Date(guess.getTime() - offset2);
  }
  return adjusted;
}

/** Az adott UTC időponthoz tartozó zónabéli nap kezdetének UTC pillanata. */
export function zonedStartOfDay(date: Date, tz: string): Date {
  const p = getZonedParts(date, tz);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, tz);
}

/** Hozzáad N naptári napot a megadott zónában (DST-átmeneten is helyes). */
export function addZonedDays(date: Date, days: number, tz: string): Date {
  const p = getZonedParts(date, tz);
  return zonedTimeToUtc(p.year, p.month, p.day + days, p.hour, p.minute, tz);
}

export function dayKeyFor(date: Date, tz: string): DayKey {
  return DAY_KEYS[getZonedParts(date, tz).weekday];
}

/** Egy zónabéli nap [start,end) UTC tartományai a heti minta alapján. */
export function dayRangesFromWeekly(
  pattern: any,
  zonedDay: { year: number; month: number; day: number; weekday: number },
  tz: string,
): { start: Date; end: Date }[] {
  const key = DAY_KEYS[zonedDay.weekday];
  const v = pattern?.[key];
  if (!v) return [];
  const ranges: [string, string][] =
    Array.isArray(v) && v.length === 2 && typeof v[0] === "string"
      ? [[v[0], v[1]]]
      : Array.isArray(v)
        ? (v as [string, string][])
        : [];
  return ranges.map(([hs, he]) => {
    const [sh, sm] = hs.split(":").map(Number);
    const [eh, em] = he.split(":").map(Number);
    return {
      start: zonedTimeToUtc(zonedDay.year, zonedDay.month, zonedDay.day, sh, sm || 0, tz),
      end: zonedTimeToUtc(zonedDay.year, zonedDay.month, zonedDay.day, eh, em || 0, tz),
    };
  });
}

/**
 * Eldönti, hogy egy "fali óra" idő létezik-e az adott zónában:
 *  - "valid": normál, egyértelmű idő
 *  - "gap":  nyári időszámítás-váltáskor kieső (nem létező) idő (pl. tavasszal 02:30)
 *  - "overlap": őszi visszaállításkor kétszer előforduló (kétértelmű) idő
 */
export function classifyLocalTime(
  year: number, month: number, day: number,
  hour: number, minute: number,
  tz: string,
): "valid" | "gap" | "overlap" {
  // Két próba: standard (utc-mínusz-1ó) és nyári (utc-mínusz-2ó) becsléssel
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const off1 = -new Date(Date.UTC(year, month - 1, day, hour, minute)).getTimezoneOffset(); // unused — placeholder
  void off1;
  // Reálisabb módszer: két lehetséges UTC pillanat ±2ó környékéről
  const candidates: Date[] = [];
  for (const hOff of [-2, -1, 0, 1, 2]) {
    candidates.push(new Date(guess.getTime() + hOff * 3600_000));
  }
  const matches = new Set<number>();
  for (const c of candidates) {
    const p = getZonedParts(c, tz);
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute) {
      matches.add(c.getTime());
    }
  }
  if (matches.size === 0) return "gap";
  if (matches.size > 1) return "overlap";
  return "valid";
}

/** A megadott UTC pillanathoz tartozó zónabéli "fali óra" idő nem létezik (DST gap)? */
export function isUtcInZonedGap(_date: Date, _tz: string): boolean {
  // Egy konkrét UTC pillanat MINDIG létezik egy zónában — a gap csak fali időre értelmezhető.
  // Tartjuk a függvényt kompat. okból, mindig false-t ad vissza.
  return false;
}
