# Terv

## 1. Adatbázis változások (migráció)

**`organization_email_settings` tábla** (1:1 az `organizations`-szel):
- `organization_id` (PK, FK)
- `sender_name`, `sender_email`, `reply_to`
- `provider` enum: `lovable_shared` (alap) | `lovable_custom_domain` | `resend`
- `custom_domain` (pl. `notify.annaszepsegszalon.hu`)
- `domain_verified_at`
- `resend_api_key_secret_name` — **nem maga a kulcs**, hanem a secret neve a Lovable secret store-ban (pl. `RESEND_KEY_ORG_<uuid>`). A kulcs sosem megy DB-be.
- RLS: csak az org owner olvashat/írhat. Platform admin (`has_role`) szintén olvashat (read-only impersonációhoz).

**`notification_templates` kiegészítése**: már megvan, csak biztosítjuk hogy van `booking_confirmed` sablon org-onként, és új változók engedélyezve: `{{provider_name}}`, `{{location}}`, `{{cancel_link}}`, `{{calendar_link}}`.

**`impersonation_log` tábla**:
- `admin_user_id`, `target_user_id`, `started_at`, `ended_at`, `reason` (kötelező), `viewed_routes` (jsonb)
- RLS: csak platform admin olvashat.

## 2. Server functions (`src/lib/email.functions.ts`)

- `getOrgEmailSettings(orgId)` — owner vagy platform admin (read).
- `updateOrgEmailSettings(orgId, settings)` — csak owner.
- `setOrgResendKey(orgId, apiKey)` — csak owner; a kulcsot a Lovable secrets-be menti, csak a secret nevét tárolja DB-ben.
- `sendBookingEmail(bookingId)` — a foglalás `organization_id`-ja alapján kikeresi a beállítást, és a megfelelő providerrel küld:
  - `lovable_shared`: közös feladó, név override
  - `lovable_custom_domain`: az org saját igazolt domainjéről
  - `resend`: az org saját Resend kulcsával, gateway-en keresztül
  - .ics csatolmány + Google Calendar link minden esetben
- Más org adatait sosem éri el (RLS + explicit org-szűrés).

## 3. Új admin oldal: `/dashboard/email-settings` (csak `owner`)

Egy oldal három szekcióval:

**A) Feladó beállítás**
- Feladó név, e-mail cím, reply-to
- Provider választó: Lovable (közös), Lovable + saját domain, Saját Resend

**B) Saját domain bekötés** (ha provider = `lovable_custom_domain`)
- Subdomain input (pl. `notify.tedomain.hu`)
- DNS rekordok megjelenítése copy-paste módon (SPF, DKIM, MX)
- „Verifikáció ellenőrzése" gomb
- Útmutató lépésről lépésre, magyar nyelven

**C) Saját Resend API kulcs** (ha provider = `resend`)
- Útmutató: hol szerezhető Resend kulcs (link resend.com/api-keys)
- Domain Resend-en belüli verifikációja
- API kulcs mentő gomb → secret store
- Teszt e-mail küldő gomb

**D) Sablonszerkesztő**
- Foglalás visszaigazolva / Emlékeztető / Lemondva / Áthelyezve
- Tárgy + body, változó-segédlet
- Élő előnézet példa adattal
- „Teszt küldés saját címemre" gomb

## 4. Platform admin oldal kiegészítés

A `/admin` user-táblába egy új oszlop: **„Nézet" gomb** (szem ikon).

Kattintás → indul read-only impersonációs session:
- Modal: **indok kötelező megadása** (pl. „Ügyfél bejelentés #1234")
- `impersonation_log`-ba bekerül
- Banner felül: „**OLVASÁSI MÓD** — XY nevében nézed (indok: ...) [Kilépés]"
- A UI minden írási műveletet letilt (gombok disabled, formok read-only)
- Műszakilag: AuthContext kap egy `impersonatedUserId`, a server function-ök egy új middleware-rel ellenőrzik: ha impersonate van, csak SELECT engedélyezett

## 5. Jogi védőkorlátok (épülő)

- ÁSZF/Adatkezelési pontba szöveg-javaslat dokumentum mellékelve (nem oldal, csak `.md`)
- Impersonáció indul → kötelező indok
- Csak read; bármilyen mutáció = blokkolva server oldalon is
- Audit log minden megtekintett route-ról
- Admin felülete külön „Impersonációs napló" táb

## 6. Technikai részletek

- **Lovable Emails infrastruktúra**: setup_email_infra + scaffold_transactional_email a platform közös domainjére
- **Több sablon org-onként**: a `send-transactional-email` route-ot úgy hívjuk, hogy `templateData`-ban átadjuk az org-specifikus sablon szövegét, a sablon komponens csak rendereli — így nem kell minden orgnak külön React Email fájl
- **Resend ág**: külön server function ami a Resend gateway-t használja, NEM a Lovable queue-t (mert az a platform domainjére van kötve)
- **.ics csatolmány**: a Lovable Emails nem támogat csatolmányt → "Hozzáadás Google Naptárhoz" link minden levélben, és egy letöltési link az .ics fájlra (server route ami legenerálja)

## 7. Sorrend / commit-ok

1. Migráció: `organization_email_settings` + `impersonation_log` tábla
2. `email.functions.ts` server functionök
3. `/dashboard/email-settings` oldal (sablon + feladó rész előbb, domain/Resend utána)
4. Lovable Emails infrastruktúra inicializálás (közös platform domainnel)
5. `book.$slug.tsx` foglalás befejezésekor `sendBookingEmail` hívás
6. Admin impersonáció: middleware, banner, log tábla használat
7. `/admin` user sorba „Nézet" gomb + indok modal + impersonációs napló táb

---

**Becsült méret:** ~10-12 fájl módosítás/létrehozás, 1 nagyobb migráció. Két körben szállítom: először (1-5) az e-mail rész, utána (6-7) az impersonáció — így tudsz közben tesztelni.

**Jóváhagyod így, vagy módosítsam? Külön jelezd, ha:**
- A platform közös domainjét akarod megadni (különben tied dönthetsz arról, hogy mi legyen — pl. `notify.foglalas-app.hu`)
- Az impersonációhoz a read-only túl szűk és inkább „read + indokolt write"-ot szeretnéd
