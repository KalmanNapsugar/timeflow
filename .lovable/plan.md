# Naptár foglalási logika — implementációs terv

A csatolt Excel 5 pontja alapján. Jelenleg a séma nagy része megvan (resources, service_resources, staff_services, bookings.resource_id), de hiányzik **a staff↔erőforrás hozzárendelés táblája**, az **erőforrás-konfliktus ellenőrzés** és a **naptár szűrők/jogosultsági szűrés**.

## 1) Adatbázis migráció

**Új tábla — `staff_resource_assignments`** (alkalmazott ↔ erőforrás)
- `staff_profile_id`, `resource_id`, `organization_id`
- `kind`: `'always' | 'weekly' | 'window'`
- `weekly_pattern_json` jsonb — heti minta, pl. `{"mon":[["09:00","13:00"]], "tue":[...]}` (csak `weekly` esetén)
- `starts_at`, `ends_at` timestamptz — konkrét időablak (csak `window` esetén; több sor = több ablak)
- `active` boolean, `created_at`, `updated_at`
- **RLS**: owner mindent ír; org tagok olvashatják (a saját naptárukhoz); platform_admin mindent lát.
- `GRANT` `authenticated`-nek + `service_role`-nak.

**`bookings` policy bővítések**
- `bookings_update`: alkalmazott (org tag, akit érint a staff_profile_id) is módosíthassa → új policy.
- `bookings_delete`: új DELETE policy owner/érintett alkalmazott/ügyfél részére.

## 2) Server function-ök (`src/lib/bookings.functions.ts` és új `src/lib/staff-resources.functions.ts`)

### Bővített konfliktusellenőrzés (createBooking + createGuestBooking)
A meglévő staff-ütközés mellé:
- **Erőforrás-ütközés**: meghatározzuk a foglalás által „lefoglalt" erőforrásokat = `bookings.resource_id` UNION `service_resources(service_id)`. Bármely átlapoló másik foglalás, ami ugyanazt az erőforrást használja → tiltás.
- **Staff↔erőforrás hozzárendelés-ütközés**: ha az időszakban a kiválasztott erőforrást egy MÁSIK alkalmazott `staff_resource_assignments`-szel lefoglalja (always/weekly/window), és más a választott alkalmazott → tiltás.

### Új végpontok
- `updateBookingTime({bookingId, startAt})` — staff/owner áthelyez; konfliktusellenőrzéssel; `notification_logs` insert (`booking_rescheduled`).
- `cancelBookingAsStaff({bookingId, reason})` — staff/owner törlés (status=`cancelled_by_provider`); értesítés (`booking_cancelled_by_provider`).
- `listStaffResourceAssignments({organizationId, from?, to?})`
- `upsertStaffResourceAssignment(...)`, `deleteStaffResourceAssignment({id})`

## 3) UI — `src/routes/dashboard.calendar.tsx`

**Szűrő sáv (üzlet admin nézet):** 3 multi-select dropdown
- **Erőforrások**: típus választása (`szoba`/`szék`/`eszköz`/`egyéb`) ÉS/VAGY konkrét erőforrás.
- **Alkalmazottak**: konkrét staff_profile-ok.
- **Szolgáltatások**: szolgáltatások szerint.
A szűrő a naptárrá renderelt foglalásokra ÉS a staff-resource blokkokra is alkalmazódik.

**Alkalmazott (staff) nézet** (impersonáció vagy saját login alapján):
- A query csak az ő bookings-jeit + az ő staff_resource_assignments-jeit hozza vissza. Szűrősáv elrejtve.

**Vizualizáció (Napi / Heti):**
- Foglalások: a meglévő színes blokkok.
- Erőforrás-hozzárendelések: halvány szürke csíkos overlay az adott alkalmazott oszlopában az időszak alatt (vagy ha „mindegyik alkalmazott egy nézetben", akkor erőforrásonként színkód).

**Foglalás-kattintás dialog (staff/owner):**
- „Időpont módosítása" (datetime input) + „Foglalás törlése" gomb. Mindkettő confirm + automatikus e-mail (notification_log).

## 4) UI — `src/routes/dashboard.staff.tsx`

Új szekció minden alkalmazottnál: **„Erőforrás hozzárendelések"**
- Lista a meglévőkről + „+ Hozzárendelés" gomb → dialog:
  - Erőforrás kiválasztó
  - Típus: `Állandó` / `Heti ismétlődő` / `Egyedi időszak`
  - Heti minta szerkesztő (napok + idősávok)
  - Vagy egy kezdő–záró dátum/idő pár

## 5) UI — `src/routes/dashboard.services.tsx` (kicsi finomítás)
- A szolgáltatás-szerkesztőben már megvannak a staff/erőforrás összerendelések; csak ellenőrzöm, hogy az 1–3 pont kapcsolódó UI tényleg megfelelően menti a `staff_services` / `service_resources` táblákat. (Nem írom át, ha működik.)

## Műszaki megjegyzések

```text
Konfliktusellenőrzés erőforrásra:
─────────────────────────────────
1) Lockolt erőforrások a NEW foglalásra:
   R_new = {bookings.resource_id} ∪ {service_resources(NEW.service_id).resource_id}
2) Más overlapping bookings:
   tiltva ha létezik B != NEW, B.status ∈ {confirmed, checked_in, pending_payment},
   átlapol (start<NEW.end ÉS end>NEW.start), ÉS R_new ∩ R_B ≠ ∅
3) Más alkalmazott staff_resource_assignment-ja:
   tiltva ha staff_profile_id(NEW) ≠ assignment.staff_profile_id,
   resource_id ∈ R_new, és az időablak átfed.
```

A `staff_resource_assignments` időablak-ütközést Postgres oldalon JS-ben számoljuk (a heti minta miatt egyszerűbb mint pure SQL), a server function-ben.

## Megerősítendő pontok (a tervből még nyitva)

Nincs nyitott kérdés — a 3 választott opció (Mindkettő / Csak dialog / Időpont mód + törlés) alapján egyértelmű minden.

---

Ha jónak ítéled a tervet, indítom a migrációval, majd a server function-ökkel, végül az UI-jal. A becsült érintettség: 1 új migráció, 2 új és 1 módosított .functions.ts fájl, dashboard.calendar.tsx + dashboard.staff.tsx jelentősebb bővítése.
