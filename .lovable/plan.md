# Terv: tulajdonos-beállítás, üzlet-felhasználó nézet, alkalmazott-meghívás

## 1) Próba üzletek tulajdonosa

Jelenlegi állapot az adatbázisban (már megfelel a kérésnek):
- **Luna Beauty Studio** → owner = platform admin (ca7f2900-…)
- **Nyugalom Wellness** → owner = NULL (nincs tulajdonosa)

Ez pont az általad kért szétválás. Külön migráció nem szükséges; csak megerősítem és dokumentálom.

## 2) Üzletek listája az admin oldalon

Az `/admin` oldalra új **„Üzletek"** tab kerül, amely felsorolja az összes szervezetet, és minden sorhoz mutatja:
- üzlet neve, slug, tulajdonos (e-mail vagy „nincs tulajdonos")
- a hozzá tartozó **alkalmazottak** listája (e-mail + szerep: owner / staff) az `organization_members` táblából + az `organizations.owner_id` alapján

Új server function `src/lib/admin.functions.ts`-ben: `listOrganizationsWithMembers` (admin-only, `supabaseAdmin`-nel).

## 3) Alkalmazott meghívás regisztrált felhasználó e-mailével

### Adatbázis
Új tábla: `staff_invitations`
- `id`, `organization_id`, `invited_email` (lowercased), `invited_by` (admin auth uid), `status` enum (`pending`/`accepted`/`declined`/`revoked`), `created_at`, `responded_at`
- RLS:
  - owner SELECT/INSERT/UPDATE saját org-ra
  - meghívott user SELECT/UPDATE, ahol `invited_email = (SELECT email FROM auth.users WHERE id = auth.uid())` → ezt server fn-nel oldjuk meg (security definer fv vagy serverFn middleware-rel), hogy ne kelljen `auth.users`-t exposolni RLS-ből
- GRANT a szokásos owner + authenticated SELECT (saját meghívásokhoz serverFn-en át)

### Server functions (`src/lib/staff.functions.ts`)
- `inviteStaff({ organizationId, email })` — owner only. Validál: létezik-e regisztrált user ezzel az e-maillel (`supabaseAdmin.auth.admin.listUsers` szűréssel vagy direct SQL). Ha nem létezik → hiba „Nincs ilyen regisztrált felhasználó". Ha létezik → upsert `staff_invitations` (`pending`).
- `listOrgInvitations({ organizationId })` — owner only.
- `listMyInvitations()` — bármely auth user: visszaadja a saját pending meghívásait (e-mail egyezés alapján, serverFn-ben).
- `respondInvitation({ invitationId, accept })` — auth user, csak ha az ő e-mailje. Ha `accept`: beszúr `organization_members` (`role='staff'`, `active=true`) és frissíti `user_roles`-t (`staff`), majd `accepted` státusz. Ha decline: `declined`.
- `revokeInvitation`, `removeStaffMember` — owner only.

### UI: új oldal `/dashboard/staff` (már létezik – kibővítjük)
- „Csapat" lista (org_members) + „Meghívások" szekció
- Mező: meghívandó e-mail + „Meghívás küldése" gomb
- Lista a függő meghívásokról + visszavonás gomb
- Aktív alkalmazottak listája + „Eltávolítás" gomb

### UI: profil oldal `/profile` (új)
- Bármely bejelentkezett felhasználó látja
- Szekció: „Alapadatok" (név, e-mail, jelszócsere link)
- Szekció: **„Függő alkalmazotti meghívások"** — minden pending meghíváshoz: üzlet neve, „Elfogadás" / „Elutasítás" gomb
- Hozzáadás a `dashboard.tsx` sidebar-ba és a `SiteHeader` user menüjébe „Profilom" link
- `role_permissions` táblába `/profile` minden szerepkörnek (customer felfelé)

## 4) Sorrend
1. Migráció: `staff_invitations` tábla + GRANT + RLS
2. `staff.functions.ts` server functionök
3. `/dashboard/staff` oldal kibővítése meghívásokkal
4. `/profile` oldal létrehozása + nav-ba kötés
5. `admin.tsx` új „Üzletek" tab + `listOrganizationsWithMembers`
6. Adatellenőrzés: a két próba üzlet tulajdonosi állapota helyes (már OK)

## Jogi / biztonsági megjegyzés
- A meghívás **csak már regisztrált** felhasználóra megy ki (kérted), így nincs nem-regisztrált e-mailre küldés → adatvédelmi kockázat minimális.
- A profilon való elfogadás kétlépcsős hozzájárulás, ami GDPR-szempontból kifogástalan.
- Az e-mail létezésének ellenőrzése server-oldalon történik, soha nem szivárog ki kliensre a többi user e-mailje.
