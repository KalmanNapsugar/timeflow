# Új funkciók terve

Mivel ez 7 különálló, közepes-nagy feladat, javaslom 3 ütemben szállítani. Mindegyiket külön is jóváhagyhatod, vagy mehet az egész.

## 1. ütem — Adatmodell + foglalás-log alap (DB migráció)

Új/módosított táblák:
- `services.tags text[]` oszlop hozzáadása (#4)
- `staff_profiles.availability_windows_json` már létezik — UI bővítés (#7-hez)
- `booking_audit` új tábla (#2 — strukturált foglalás-log):
  - `organization_id`, `booking_id`, `booked_at` (mikor foglalt), `start_at` (befoglalt időpont)
  - `customer_name`, `customer_email`, `customer_phone`
  - `is_new_customer boolean` (számolva: volt-e korábbi foglalás ugyanezzel az e-maillel vagy telefonnal)
  - `service_id`, `service_name`, `service_price`
  - `prepaid boolean`, `staff_profile_id`, `staff_name`
  - RLS: owner + staff olvashatja, insert backend
- `bookings.functions.ts` `createBooking`/`createGuestBooking`: minden foglalás végén beírja a `booking_audit` rekordot, kiszámolva az `is_new_customer` flaget egy `SELECT EXISTS` lekérdezéssel

## 2. ütem — Üzlet tulajdonos felületek (#1, #2, #3, #4, #5)

Új menüpontok a `/dashboard` bal oldali navigációban:
- **Exportok** (`/dashboard/exports`): 4 gomb, mind XLSX letöltés szerver-fn-ből (`exportXlsx` server fn, SheetJS / `xlsx` lib)
  - Szolgáltatások listája
  - Alkalmazottak listája
  - Erőforrások listája
  - Foglalások (a `booking_audit` táblából, dátum-szűrővel)
- **Statisztikák** (`/dashboard/stats`): pivot-szerű nézet a `booking_audit` adatokon
  - Szűrők: dátum-tartomány, alkalmazott, szolgáltatás, új/visszatérő ügyfél, fizetési státusz
  - Csoportosítás (sor + oszlop választható): alkalmazott, szolgáltatás, hét/hónap, új vs. visszatérő
  - Mértékek: foglalás-szám, összes bevétel, átlag ár
  - Tábla + egyszerű oszlop-/vonal-diagram (recharts, már elérhető)

Meglévő `/dashboard/services` bővítése (#4, #5):
- Szolgáltatás szerkesztő űrlapban tag-szerkesztő (vesszővel elválasztott input → text[])
- Lista tetején tag-szűrő (multi-select)
- Minden sor mellé „Másolás" gomb → új szolgáltatás `(másolat)` utótaggal, ugyanazokkal a mezőkkel, azonnal megnyitja szerkesztésre

## 3. ütem — Ügyfél + alkalmazott felületek (#6, #7)

- **Ügyfél heti naptár** (`/my-bookings` mellé új tab vagy `/my-bookings/calendar`): a saját foglalásai egy heti naptár nézetben (hasonló a `dashboard.calendar`-hoz, de csak a saját foglalásait mutatja, navigálható hét előre/hátra)
- **Alkalmazott rendelkezésre állási időablakok** (`/dashboard/staff` szerkesztő bővítése, illetve ha az illető staff szerepkörrel lép be, saját profil oldal):
  - „Rendelkezésre állási időablakok" szekció: lista (dátum-tól + dátum-ig + típus: elérhető/elérhetetlen)
  - Add / törlés / szerkesztés → `staff_profiles.availability_windows_json`-be ír
  - Az `availability.functions.ts` már figyelembe veszi a `availability_windows_json`-t, csak UI kell

## Technikai részletek

- XLSX: `xlsx` (SheetJS) csomag — pure JS, Worker-kompatibilis (nincs natív bináris). `bun add xlsx`. Szerver-fn `Buffer`-t/`base64`-et ad vissza, frontend `Blob`-ként menti.
- Foglalás-log az új `booking_audit` táblába megy — denormalizált snapshot, így az exportok akkor is helyes adatot mutatnak, ha a szolgáltatás neve/ára később változik vagy az ügyfél törölve lesz.
- `is_new_customer` számolás: `SELECT EXISTS(SELECT 1 FROM booking_audit WHERE organization_id=? AND (customer_email=? OR customer_phone=?))` a foglalás insertje ELŐTT.
- Statisztika oldal: minden számolás a `booking_audit` táblán, szerver-fn-ben aggregálva (nem a teljes adat letöltése a kliensbe).
- Tag-ek: egyszerű `text[]` oszlop, GIN index a gyors szűréshez. Pivot UI: `Combobox` + `Badge` komponensekkel.

## Kérdés — hogyan szállítsam?

Melyiket szeretnéd először? Lehetőségek:
- **A)** Mindhárom ütemet egyben, egymás után (~3 üzenetváltás, mert a migráció külön jóváhagyást kér).
- **B)** Csak az 1. ütem most (DB + log), aztán szólsz a többiért.
- **C)** Más sorrend — pl. előbb a tag + másolás (#4, #5), mert az gyors és látványos.
