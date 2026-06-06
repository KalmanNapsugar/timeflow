# Terv: AI asszisztens + általános foglalási rendszer pozícionálás

Két nagy feladat, együtt szállítjuk.

---

## 1. Valódi AI asszisztens (`/dashboard/ai-assistant`)

### Backend
- **Új server function**: `src/lib/ai-assistant.functions.ts`
  - `askAssistant({ organizationId, messages })` – `requireSupabaseAuth` middleware.
  - Lovable AI Gateway-t hív (`google/gemini-3-flash-preview`, streaming SSE).
  - **Tool calling** az alábbi analitikai tool-okkal (mind ugyanazon szerveroldalon, Supabase-ből számolva):
    1. `get_bookings_count` – paraméter: `from`, `to` (pl. „ezen a héten")
    2. `get_top_services_by_revenue` – paraméter: `from`, `to`, `limit`
    3. `get_inactive_customers` – paraméter: `days` (alapért. 90)
    4. `suggest_available_slots` – paraméter: `service_id?`, `staff_profile_id?`, `date_from`, `date_to`
    5. `get_schedule_bottlenecks` – kihasználtság/időkeret/erőforrás szűk keresztmetszetek
  - Minden tool a `supabaseAdmin` clienttel kérdez, de **szigorúan az `organizationId`-re szűr** (jogosultság ellenőrzés mint a `listBookingAudit`-ben).
  - A tool-eredményeket strukturáltan visszaadjuk (számok + rövid táblázat-szerű adat), majd az LLM természetes nyelvű választ ad, és JSON `chart` blokkot is beilleszthet markdown code fence-ben (pl. `chart:bar`) – a UI ezt felismeri és Recharts diagrammá renderelheti.

- **Streaming**: route-on (`src/routes/api/ai-assistant.ts`) POST handler, SSE stream az AI Gateway-ről.
  - Bearer token a `requireSupabaseAuth`-on át, vagy a route maga ellenőrzi a usert + org tagságot.
  - Saját Lovable Cloud secret: `LOVABLE_API_KEY` (már be van állítva).

### Frontend (`src/routes/dashboard.ai-assistant.tsx`)
- A „Hamarosan" placeholder cseréje valódi chat UI-ra:
  - Üzenetlista, input, küldés gomb.
  - `react-markdown` a válaszhoz (`prose` osztály), token-by-token streaming.
  - Diagram render: ha az asszisztens `\`\`\`chart\n{...}\n\`\`\`` blokkot ad vissza, akkor `recharts` (BarChart/LineChart/PieChart) komponensekkel megjelenítjük.
  - Quick-prompt gombok az 5 mintakérdéssel.
  - Conversation history csak memóriában (nincs perzisztencia – a feladat nem kéri).

---

## 2. Pozícionálás: általános online foglalási rendszer

### Landing (`src/routes/index.tsx`)
- Hero headline + alcím átírva általános foglalási rendszerre.
  - Headline: „Online foglalások egyszerűen"
  - Sub: **„Fogadj online foglalásokat, kezeld a naptárad, munkatársaid, szolgáltatásaid és ügyfeleidet egy egyszerű felületről."**
- Célközönség említve: szépségszalonok, kozmetikusok, wellness, edzők, tanácsadók, oktatók, kisrendelők.
- Feature kártyák hangsúlya: foglalás, naptár, staff, ügyfelek, riportok.
- SEO meta title/description frissítve.

### Dashboard navigáció (`src/routes/dashboard.tsx`)
- Címkék felülvizsgálata – általános, gyakorlatias megfogalmazás:
  - „Áttekintés", „Naptár", „Szolgáltatások", „Munkatársak", „Ügyfelek", „Erőforrások", „Riportok", „Beállítások" – ezek többsége már jó. Apró finomhangolás (pl. „AI asszisztens" marad).
- Áttekintő oldal (`dashboard.index.tsx`):
  - **Mai foglalások**, **közelgő foglalások (7 nap)**, gyors statok (összes, befejezett bevétel) – részben már megvan, finomítjuk.
  - „Új foglalás" + „Naptár megnyitása" gyors gombok.

### Public booking flow (`src/routes/book.$slug.tsx`, `book.confirmed.*`)
- Audit + apróbb UX javítások: lépések címkézése (1. Szolgáltatás → 2. Munkatárs → 3. Időpont → 4. Adatok → 5. Megerősítés), mobile-first padding, gombok.
- Megerősítő oldal: kiemelt **lemondás/áthelyezés link** (token alapú, ha már létezik – ha nem, csak vizuális hangsúly + email-emlékeztető).
- Csak akkor írunk át üzleti logikát, ha a meglévő flow hiányos; egyébként marad.

### Onboarding / új org (`organizations.new.tsx`)
- Bevezető szöveg általánosítva (pl. „Indítsd el a saját online foglalási rendszered – szalon, wellness, edzőterem, tanácsadás, oktatás vagy bármilyen időpont-alapú szolgáltatás").

### Demó adatok
- A meglévő demo szervezetek (`luna-beauty`, `nyugalom-wellness`) jól illeszkednek, **nem módosítjuk** a seedet, csak az UI feliratokat. Mintakérdésekben általános példák.

---

## Technikai részletek

- **Új csomag**: `recharts` (már jelen van az `ui/chart.tsx` miatt – ellenőrizzük; ha nincs, `bun add recharts`). `react-markdown` szintén – ellenőrizzük, szükség esetén `bun add react-markdown`.
- **AI Gateway hívás**: edge-stílusú streaming route TanStack server route-tal (`src/routes/api/ai-assistant.ts`), POST, SSE relay.
- **Jogosultság**: csak owner/staff hívhatja, az `organizationId` ellenőrizve a `organizations.owner_id` vagy `organization_members`-ben.
- **Hibakezelés**: 429 → toast „Túl sok kérés", 402 → „Kredit elfogyott".
- **Memóriában**: nem perzisztálunk üzeneteket (a feladat nem kéri).

---

## Mit NEM csinálunk most
- Nem írjuk át a teljes seedet / demo szervezet neveit.
- Nem rakunk be új auth/role logikát.
- Nem perzisztáljuk a chat-történetet (ha kell, későbbi körben).
- Nem nyúlunk a naptár vertikális sáv logikájához (az előző körben javítottuk).

Ha jóváhagyod, kezdem az implementációt.