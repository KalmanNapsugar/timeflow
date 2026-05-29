## IdőpontFlow MVP — fázisolt felépítés

A teljes spec (30+ tábla, 4 szerepkör, marketplace, dashboard, CRM, marketing, riportok, AI assistant) egy menetben nem reális — több ezer sor kód, és a végén egyik rész sem lenne csiszolt. Javaslom 3 fázisra bontva, minden fázis önállóan demo-képes.

### Fázis 1 — Alapok + foglalási flow (ezt építem most)

**Backend (Lovable Cloud / Supabase)**
- Auth (email/jelszó + Google), `profiles` tábla `app_role` enummal (guest/staff/owner/platform_admin) külön `user_roles` táblában
- Core sémák RLS-sel: `organizations`, `organization_members`, `locations`, `service_categories`, `services`, `staff_profiles`, `staff_services`, `resources`, `customers`, `bookings`, `booking_locks`, `intake_forms`, `intake_questions`, `intake_answers`, `payments`, `notification_logs`, `audit_logs`
- Server function: `createBooking` — szerveroldali konfliktusellenőrzés (staff + resource + opening hours), atomic insert
- Seed: 2 szervezet, 2 helyszín, 6 kategória, 18 szolgáltatás, 6 staff, 3 resource, 20 ügyfél, 40 booking

**Frontend (publikus + guest)**
- `/` landing (hero, kategóriák, search CTA)
- `/search` marketplace szűrőkkel (kategória, város, dátum)
- `/provider/:slug` szolgáltató profil
- `/book/:providerSlug` 6-lépéses foglalási wizard (szolgáltatás → staff → időpont → adatok + intake → policy consent → mock deposit → confirm)
- `/book/confirmed/:bookingId`
- `/login`, `/signup`
- `/my-bookings` + `/my-bookings/:id` (lemondás/módosítás policy szerint)

**Frontend (provider dashboard — minimum életképes)**
- `/dashboard` overview kártyák
- `/dashboard/calendar` napi/heti nézet (lista+naptár hibrid)
- `/dashboard/bookings` tábla szűrőkkel
- `/dashboard/services` CRUD
- `/dashboard/staff` CRUD + working hours
- `/dashboard/customers` lista + profil

Magyar UI, mobile-first, shadcn/ui, design system tokenekkel (`src/styles.css`), saját arculat (nem Salonic-másolat).

### Fázis 2 — Üzleti mélység (külön körben)
Resources CRUD UI, marketing (kuponok/voucherek/csomagok), reviews flow, riportok (revenue/utilization/top services/no-show), settings (cancellation policy szerkesztő, notification template-ek), inventory, audit log nézet, AI assistant placeholder oldal.

### Fázis 3 — Platform admin + finomítás (külön körben)
Platform admin felület, favorites, waiver signature flow, advanced filterek a marketplace-en, accessibility audit, PWA manifest + service worker, i18n struktúra (HU/EN).

### Mit NEM építünk be (placeholder marad)
Stripe/Barion, valódi SMS/email, Google Calendar sync, számlázás, térkép API, valódi AI — ahogy a prompt is kéri.

### Becslés
Fázis 1 önmagában ~40-60 fájl, ~3000-4000 sor. Egy menetben elkészíthető, de utána iterálni kell a részleteken.

**Kérdés a folytatás előtt:** OK így fázisolva, vagy szűkítsem még tovább a Fázis 1-et (pl. először csak guest booking flow, dashboard későbbre)?
