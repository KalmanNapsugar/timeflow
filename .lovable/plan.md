## Cél

Bármely olyan művelet után, ami foglalási ütközést okozhat, a rendszer azonnal lefuttat egy egységes ütközésvizsgálatot, és felugró ablakban listázza az ütközéseket, **Mégse** / **Mégis mentem** gombokkal.

## Mit minősítünk ütközésnek

1. **Munkatárs-ütközés** – ugyanaz a `staff_profile_id` két átfedő foglaláson (`confirmed` státusszal).
2. **Erőforrás-kapacitás túllépése** – egy időpontban ugyanazon `resource_id`-re több aktív foglalás, mint `resources.capacity`. A szolgáltatás-erőforrás kapcsolatokat (`service_resources`) is figyelembe vesszük.
3. **Munkaidőn kívüliség** – a foglalás vagy annak része kívül esik a hozzárendelt munkatárs `working_hours_json` + `availability_windows_json` szerinti elérhetőségén.
4. **Hiányzó erőforrás-hozzárendelés** – a munkatárs olyan szék/szoba erőforráson dolgozik, amelyre nincs aktív `staff_resource_assignments` rekord arra a napra.

## Egy közös szerver-függvény

Új fájl: `src/lib/conflicts.functions.ts`

```ts
export const detectBookingConflicts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    organizationId: string;
    scope: "booking" | "staff_hours" | "assignment" | "service";
    bookingId?: string;           // ignore self
    bookingDraft?: { start_at; end_at; staff_profile_id; service_id; resource_id? };
    staffProfileId?: string;
    serviceId?: string;
    assignmentId?: string;
    rangeFromIso?: string; rangeToIso?: string;
  }) => d)
  .handler(async ({ data, context }) => { ... return { conflicts: Conflict[] } });
```

`Conflict` típus: `{ kind: "staff_overlap"|"capacity"|"out_of_hours"|"missing_assignment"; bookingId; message; details }`.

A logika a meglévő `checkInternalBookingConflicts`-ot bővíti, és a `resolveDayPattern`-t (timezone.ts) használja munkaidő feloldására.

## Felugró ablak – `ConflictDialog`

Új komponens: `src/components/ConflictDialog.tsx`

- shadcn `Dialog`, piros fejléccel.
- Lista a 4 típusból, ütközésenként foglalás idejével, ügyfél/szolgáltatás/munkatárs nevével.
- Két gomb: **Mégse** (rollback), **Mégis mentem** (a hívó által adott `onConfirm` fut, és a háttérben jelölést tesz az ütköző foglalásokra, hogy a naptár pirossal keretezze őket).

A `useAuth().readOnly` esetén csak Mégse látszik.

## Integrációs pontok (a felsorolt 4 eset)

1. **Foglalás létrehozása / áthelyezése / időmódosítás**
   - `dashboard.calendar.tsx → NewBookingDialog`: létrehozás előtt `detectBookingConflicts({ scope:"booking", bookingDraft })`. Ha van ütközés → ConflictDialog; csak Mégis mentem után hívja a `createInternalBooking`-ot.
   - `dashboard.calendar.tsx → BookingDialog`: az időpont- és státusz-mentés (`updateBookingTime`) előtt ugyanez, az adott `bookingId` kizárásával.

2. **Munkatárs munkaidő / elérhetőségi ablakok módosítása**
   - `dashboard.my-availability.tsx`, illetve `dashboard.staff.tsx` (a munkaidő-szerkesztő részben): mentés előtt `scope:"staff_hours"` lekér minden jövőbeni `confirmed` foglalást az érintett staffre, és ellenőrzi az új munkaidőhöz képest. Ütközéslista → ConflictDialog; Mégis mentem esetén marad a mentés.

3. **Erőforrás-hozzárendelések módosítása**
   - `dashboard.resources.tsx` (illetve a staff–erőforrás kezelő): `scope:"assignment"` az adott `staff_profile_id` jövőbeni foglalásait ellenőrzi (új heti minta/időablak alapján van-e munkaidő/erőforrás lefedés).

4. **Szolgáltatás időtartam / erőforrás-igény módosítása**
   - `dashboard.services.tsx`: mentés előtt `scope:"service"` az adott szolgáltatás jövőbeli `confirmed` foglalásaira lefuttatja a kapacitás-ellenőrzést az új paraméterekkel (új `duration_minutes` → új `end_at`-ot számolunk virtuálisan).

## Vizuális jelzés a naptárban (kiegészítő, kérésed alapján)

- A `bookings` lekérdezés mellé minden látható naphoz egyszeri `detectBookingConflicts({ scope:"booking", rangeFromIso, rangeToIso })`-t futtatunk, az érintett foglalások id-jeit egy `Set`-ben tartjuk.
- A `TimeGridDay` foglalás-gombja piros kerettel (`ring-2 ring-destructive`) jelenik meg, ha az id-ja a halmazban van; rámutatáskor tooltipben az ütközés rövid leírása.

## Technikai megjegyzések

- Idő-átfedés: `a.start < b.end AND b.start < a.end`.
- Kapacitás: egy időpontban legfeljebb `capacity` aktív foglalás engedett — sweep algoritmus a percek mentén.
- Munkaidő-feloldás: `resolveDayPattern` a `staff_profiles.working_hours_json`-re és (ha van) `availability_windows_json` metszete.
- Hiányzó assignment: csak `room`/`chair` típusú erőforrásokra értelmezzük (eszköz/egyéb nem releváns).
- Idő-zóna: a meglévő `org.timezone` szerint, a `start_at` ISO marad.
- A meglévő `checkInternalBookingConflicts`-ot megtartom, de mostantól delegál az új közös fv-re; így nincs duplikált logika.

## Fájlok

- Új: `src/lib/conflicts.functions.ts`, `src/components/ConflictDialog.tsx`
- Módosítás: `src/routes/dashboard.calendar.tsx`, `src/routes/dashboard.my-availability.tsx`, `src/routes/dashboard.staff.tsx`, `src/routes/dashboard.resources.tsx`, `src/routes/dashboard.services.tsx`
- Apró bővítés: `src/lib/internal-bookings.functions.ts`, `src/lib/bookings.functions.ts` (a frontnak nem kell változnia, a dialog wrappereli a hívást)

Megerősíted, hogy így megépíthetem?