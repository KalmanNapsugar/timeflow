# Eszköz erőforrások új szabályrendszere

A "eszköz" (equipment) típusú erőforrás eddig úgy működött, mint egy szoba/szék: munkatárshoz volt rendelve. A 4 új szabály szerint az eszköz egy önálló, mozgatható erőforrás, ami **szolgáltatáshoz** (igény) és **szobához/székhez** (lehetséges helyszín) rendelődik, és a foglalás idejére exkluzívan le van foglalva.

## Új adatmodell

Új tábla: **`equipment_locations`** — eszköz ↔ szoba/szék kapcsolat (több-a-többhöz).
```
equipment_locations(
  id uuid pk,
  organization_id uuid,
  equipment_resource_id uuid,   -- type='equipment' resource
  location_resource_id uuid,    -- type='room' vagy 'chair' resource
  created_at timestamptz
)
```
Egyedi (equipment_resource_id, location_resource_id) páros. RLS: owner/admin write, public read az aktív orgnak.

A `service_resources` táblát változatlanul használjuk eszközök szolgáltatáshoz rendeléséhez (group_no marad, OR-csoport logika eszközökre is ugyanúgy).

A `staff_resource_assignments` tábla **csak szoba/szék típusra** működjön — eszköz nem rendelhető munkatárshoz.

## Szabályok implementálása

### Szabály 1 — UI korlátozás
- `dashboard/staff` (Erőforrások dialog): eszköz típusú erőforrásokat **eltávolítjuk** a hozzárendelhető listából.
- `dashboard/services` (szolgáltatás-szerkesztés → erőforrások): minden típus választható (szoba/szék/eszköz).
- `dashboard/resources` (eszköz kártyán): új **"Helyszínek"** gomb → dialog, amiben a szervezet összes szoba/szék listája pipálható; mentés `equipment_locations` táblába.

### Szabály 2 — szemantika
- Szolgáltatás → eszköz: igény (mit kell hozzá).
- Szoba/szék → eszköz: lehetőség (hol érhető el).

### Szabály 3 — foglalás csak megfelelő helyszínre
A `getAvailableSlots`-ban (`src/lib/availability.functions.ts`):
- A szolgáltatás OR-csoportjaiban szétválasztjuk az **eszköz** és **helyszín (szoba/szék)** erőforrásokat.
- A jelölt slot helyszín-erőforrásait szűkítjük azokra, amelyek az `equipment_locations` szerint **tartalmazzák** az adott szolgáltatás összes szükséges eszközét. (Ha pl. a szolgáltatáshoz "UV lámpa" kell, csak az a szoba/szék foglalható, ahová az UV lámpa be van regisztrálva.)
- Ha egyik szoba/szék sem felel meg, nincs slot.

### Szabály 4 — eszköz időbeli blokkolás
- A `getAvailableSlots`-ban a párhuzamos foglalások (`bookings`) erőforrás-fogyasztásának számolásánál minden olyan foglalás, amelynek szolgáltatása ugyanazt az eszközt igényli, az adott `[start_at, end_at)` intervallumra **lefoglalja** az eszközt (kapacitás=1).
- A `createBooking`-ban (`src/lib/bookings.functions.ts`) a meglévő erőforrás-ütközés ellenőrzés ugyanezt a logikát alkalmazza: ha az eszköz időben már egy másik foglalásban van, a foglalás visszautasítva.
- Mivel a `bookings.resource_id` csak egy erőforrásra mutat (a helyszínre), az eszköz "használatát" implicit módon a szolgáltatás eszközigényéből vezetjük le — nincs séma-változás a `bookings`-on.

## Érintett fájlok

**Migration (új tábla):** `equipment_locations` + RLS + grant.

**Kód:**
- `src/lib/staff-resources.functions.ts` — `upsertStaffResourceAssignment`: ha az erőforrás típusa `equipment`, dobjunk beszédes hibát ("Eszköz típusú erőforrás nem rendelhető munkatárshoz — szolgáltatáshoz és szobához/székhez rendelhető.")
- `src/lib/equipment-locations.functions.ts` (új): `listEquipmentLocations`, `setEquipmentLocations(equipmentId, locationIds[])`, `listLocationsForEquipment`, `listEquipmentForLocation`.
- `src/lib/resource-groups.ts` — kibővítjük: csoportokban a resource_id-k mellé eltároljuk a resource típusát (szétválaszthassuk eszköz / helyszín).
- `src/lib/availability.functions.ts` — `getAvailableSlots`:
  - Beolvassuk a `resources.type`-ot a szolgáltatás erőforrásaihoz és az `equipment_locations`-t.
  - Helyszín-szűrés: minden csoportban a helyszín jelölteket szűkítjük úgy, hogy minden szükséges eszközt tartalmazzák.
  - Eszköz-blokkolás: párhuzamos bookings → ha a foglalás szolgáltatásának eszközigénye átfed az új jelölttel, az eszköz blokkolt időben.
- `src/lib/bookings.functions.ts` — `createBooking`-ban hasonló eszköz-ütközés ellenőrzés a confirm előtt.
- `src/routes/dashboard.staff.tsx` — Erőforrások dialog: kiszűrjük az `equipment` típusú sorokat.
- `src/routes/dashboard.resources.tsx` — eszköz kártyán új "Helyszínek" gomb + dialog (checkbox-lista a szobákról/székekről), valamint kis buborékokban listázzuk a kapcsolt helyszíneket.

## Nem érintett

- Naptárnézet (`dashboard.calendar.tsx`).
- A meglévő szoba/szék kapacitás (szabály 2 munkatárs-oldali exkluzivitás) változatlan.
- A widget UI flow (szolgáltatás → munkatárs → idő → megerősítés) változatlan.

## Megerősítés

Ez kb. 1 új tábla + 1 új serverfn-modul + 4 fájl-módosítás. Folytatom az implementációval?
