# Üzlet archiválás, törlés, mentés/visszatöltés (platform admin)

## Funkciók
1. **Archiválás** – platform admin egy gombbal archiválhat bármely üzletet. Archivált üzlet minden felhasználó számára (tulajdonos, alkalmazott, vendég, ügyfél) inaktív: nem jelenik meg a keresőben, nem lehet foglalni, a dashboard üzletválasztóból eltűnik. Csak a platform admin látja és tudja visszaállítani (un-archive).
2. **Törlés** – platform admin véglegesen törölhet egy üzletet egy `confirm` (modal: gépeld be az üzlet nevét) megerősítés után. A törlés kaszkádol minden kapcsolódó adatra (foglalások, szolgáltatások, alkalmazottak, ügyfelek, stb.).
3. **Export (mentés)** – archivált üzlet "csomagként" letölthető JSON fájlként, ami tartalmazza az üzletet és minden hozzá tartozó adatot (services, staff_profiles, customers, bookings, locations, resources, intake_forms, coupons, vouchers, inventory_items, notification_templates, organization_email_settings, organization_members, audit_logs, stb.).
4. **Import (visszatöltés)** – platform admin feltölthet egy korábban exportált JSON fájlt. A rendszer visszaállítja az üzletet és minden adatát ugyanazokkal az ID-kkal **archivált állapotban** (hogy ne lépjen azonnal éles üzembe — utána a platform admin un-archive-olhatja).

## Technikai megvalósítás

### 1. DB migráció
- `organizations.archived_at TIMESTAMPTZ NULL` oszlop.
- `organizations` RLS frissítése: `orgs_public_read`, `orgs_owner_all` policy-k kiegészítése `archived_at IS NULL`-lal — tehát archivált üzlethez csak `platform_admin` férhet hozzá (új policy: `orgs_admin_all` → `has_role(auth.uid(), 'platform_admin')`).
- Minden kapcsolódó tábla publikus olvasási policyját (services, staff_profiles, locations, resources, service_categories, service_packages, intake_forms, stb.) kiegészítjük egy `EXISTS (org WHERE archived_at IS NULL OR platform_admin)` ellenőrzéssel — vagy egyszerűbben: minden ilyen olvasási policy mellé `AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_id AND (o.archived_at IS NULL OR has_role(auth.uid(), 'platform_admin')))`.
- A tulajdonos policy-k (`is_org_owner`) maradnak, de az `is_org_owner` függvényt frissítjük: archivált üzletnél `false`-t ad vissza, kivéve ha platform admin (vagy egy új helper függvény vezetjük be: `is_org_owner_or_admin`).

### 2. Server functions (`src/lib/admin-orgs.functions.ts`)
- `archiveOrganization({ orgId })` — set `archived_at = now()`.
- `unarchiveOrganization({ orgId })` — set `archived_at = null`.
- `deleteOrganization({ orgId, confirmName })` — ellenőrzi a nevet, majd `supabaseAdmin.from('organizations').delete()` (kaszkád törlés kapcsolódó táblákra → ehhez `ON DELETE CASCADE` FK-k kellenek; mivel jelenleg nincsenek FK-k, manuálisan végigtöröljük az összes táblát egy tranzakcióban egy `delete_organization_cascade` Postgres függvénnyel).
- `exportOrganization({ orgId })` — visszaad egy nagy JSON objektumot az összes táblából (admin clienttel olvasva).
- `importOrganization({ payload })` — visszaírja az adatokat admin clienttel, archivált állapotban.

### 3. UI (`src/routes/admin.tsx` → `OrgsTab`)
- Minden üzletkártyán 4 gomb: **Archiválás / Visszaállítás**, **Mentés (export JSON)**, **Törlés** (megerősítő dialog).
- Külön szekció a tab alján: **Üzlet importálása** — fájlfeltöltő, ami beolvassa a JSON-t és meghívja az `importOrganization`-t.
- Archivált üzletek vizuálisan elkülönítve (szürke háttér, "Archivált" badge).

### 4. Dashboard / üzletválasztó hatás
- A `myOrgs` / `getMyOrganizations` server function ne adjon vissza archivált üzleteket nem-admin felhasználónak.
- A publikus `/search`, `/provider/$slug`, `/book/$slug` route-okon az RLS automatikusan kiszűri az archivált üzleteket.

## Fájlok
- **új migráció**: `archived_at` oszlop + RLS frissítések + `delete_organization_cascade()` Postgres függvény.
- **új**: `src/lib/admin-orgs.functions.ts` — 5 server function.
- **módosítás**: `src/routes/admin.tsx` → `OrgsTab` kiegészítése a fenti UI-val.
- **módosítás**: `src/lib/orgs.functions.ts` (vagy ahol a `myOrgs` lista van) — archivált szűrés nem-admin esetén.

A terv jóváhagyása után létrehozom a migrációt és implementálom.