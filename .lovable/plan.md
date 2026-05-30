# Feladat — Hozzárendelési szabályok és UI átépítés

## Szabályok érvényesítése (szerveroldal)

A `upsertStaffResourceAssignment`-be (a már működő szék/szoba munkatárs-irányú ellenőrzés mellé) bekerül a fordított irányú ellenőrzés is, az erőforrás oldaláról:

- **Szék** (`chair`): max **1** munkatárs egyidejűleg hozzárendelve. Több jelölt esetén hiba.
- **Szoba** (`room`): max `resources.capacity` munkatárs egyidejűleg hozzárendelve.
- **Eszköz** (`equipment`): max **1** munkatárs egyidejűleg hozzárendelve. (Új: bekerül az exkluzív típusok közé erőforrás-oldali ellenőrzésre.)
- Munkatárs-oldali (3-as szabály) változatlan: egy munkatárs nem fedhet át időben másik szoba/szék hozzárendeléssel.
- A rendelkezési időn kívüli mentés továbbra is hibás (1-es szabály) — a beolvasás csak a munkatárs szabad idejéből indul.

Ütközés esetén beszédes magyar hibaüzenet (melyik munkatárs / erőforrás, milyen időszakban).

## `/dashboard/staff` — Munkatárs panel átépítése

Minden munkatárs paneljén **2 gomb**: `Erőforrások` és `Szolgáltatások`. Az eddig külön „Erőforrás-hozzárendelések" szakasz **eltűnik** (1c).

### „Szolgáltatások" gomb (1a)
Dialog: a munkatárshoz rendelhető szolgáltatások listája pipálható checkboxszal. A `staff_services` táblát írja, ugyanazt mint a „Szolgáltatás szerkesztése → Ki végezheti" — dinamikusan szinkronban.

### „Erőforrások" gomb (1b)
Dialog: listázza az org összes (aktív) erőforrását típus szerint csoportosítva. Minden erőforrás soron:

- **Állandó** gomb — egy kattintással `kind="always"` hozzárendelést hoz létre. Ha az erőforrás-oldali kapacitás (szék 1 / szoba `capacity` / eszköz 1) vagy a munkatárs másik exkluzív hozzárendelése **ütközne**, a gomb **letiltva**, mellette piros figyelmeztetés szövege; ekkor csak a „Beállít" választható.
- **Beállít** gomb — mindig elérhető. Megnyit egy heti naptár dialógust (`Heti hozzárendelés` + `Egyedi hozzárendelés` felirat, ugyanaz a komponens, mint a munkatárs „Heti munkaidő" / „Rendelkezésre állási időablakok"). A dialog megnyitásakor automatikusan **beolvassa** a `computeStaffResourceEffectiveAvailability` által szabadnak jelölt idősávokat (munkatárs szabad ideje ∩ erőforrás szabad ideje, levonva más exkluzív hozzárendeléseket). Az idősávok manuálisan szerkeszthetők, de mentéskor szerveroldali ütközésvizsgálat fut — ütközés esetén a mentés visszautasítva.
- Ha már van hozzárendelés erre a párra: a gomb státusza „Beállítva — szerkeszt / töröl".

## `/dashboard/resources` — Erőforrás panelek (2)

- **2a**: Minden erőforrás kártyán látható a **típus** badge (szoba / szék / eszköz / egyéb) — már most is van, csak átnézzük. A kártya alján **kis kék buborékok**: minden hozzárendelt munkatárs neve (rövidítve), tooltipben teljes név + hozzárendelés módja (állandó / heti).
- **2b**: A „Munkatársak" gomb eltávolítva.

## Technikai részek

**Új / módosított fájlok:**
- `src/lib/staff-resources.functions.ts` — fordított irányú kapacitás-ellenőrzés (`chair`=1, `room`=capacity, `equipment`=1) + listázó `listAssignmentsForResource` a buborékokhoz.
- `src/lib/staff.functions.ts` — `listStaffServiceLinks` + `setStaffServiceLink` (ha még nincs) a Szolgáltatások dialoghoz.
- `src/routes/dashboard.staff.tsx` — kártyán 2 gomb; a régi „Erőforrás-hozzárendelések" szakasz törlése; két új dialog (Szolgáltatások, Erőforrások-lista); az Erőforrások-listából megnyitható „Beállít" reuses the existing WeeklyAvailabilityEditor.
- `src/routes/dashboard.resources.tsx` — „Munkatársak" gomb törlése; kártyára kék buborékok a hozzárendelt munkatársakkal.
- A meglévő `EffectiveAvailabilityPanel` logikája beépül a „Beállít" dialog auto-feltöltésébe.

## Nem érintett

- Foglalási flow / `availability.functions.ts` változatlan (a kapacitás ott már működik).
- A 6-os és 7-es szabály (szolgáltatás-foglalás) jelenlegi viselkedése változatlan — ezekhez nincs UI feladat.
