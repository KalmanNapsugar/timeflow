import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

async function getAdminClient(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  tool_call_id: z.string().optional(),
  tool_calls: z.any().optional(),
  name: z.string().optional(),
});

const Input = z.object({
  organizationId: z.string().uuid(),
  messages: z.array(MessageSchema).min(1).max(40),
});

async function assertOrgAccess(userId: string, orgId: string) {
  const supabaseAdmin = await getAdminClient();
  const { data: org } = await supabaseAdmin
    .from("organizations").select("owner_id").eq("id", orgId).maybeSingle();
  if (!org) throw new Error("Üzlet nem található.");
  if (org.owner_id === userId) return;
  const { data: mem } = await supabaseAdmin
    .from("organization_members").select("id")
    .eq("organization_id", orgId).eq("user_id", userId).eq("active", true).maybeSingle();
  if (mem) return;
  const { data: roles } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId);
  if ((roles ?? []).some((r: any) => r.role === "platform_admin")) return;
  throw new Error("Nincs jogosultságod ehhez az üzlethez.");
}

// ---------- Analytics tool implementations ----------

async function toolBookingsCount(orgId: string, args: { from?: string; to?: string }) {
  const supabaseAdmin = await getAdminClient();
  const from = args.from ?? new Date(Date.now() - 7 * 86400000).toISOString();
  const to = args.to ?? new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("id, status, start_at, price_total")
    .eq("organization_id", orgId)
    .gte("start_at", from)
    .lte("start_at", to);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const byStatus: Record<string, number> = {};
  for (const b of rows) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
  // daily series
  const byDay: Record<string, number> = {};
  for (const b of rows) {
    const day = new Date(b.start_at).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  const series = Object.entries(byDay).sort().map(([day, count]) => ({ day, count }));
  return { from, to, total: rows.length, byStatus, series };
}

async function toolTopServices(orgId: string, args: { from?: string; to?: string; limit?: number }) {
  const supabaseAdmin = await getAdminClient();
  const from = args.from ?? new Date(Date.now() - 30 * 86400000).toISOString();
  const to = args.to ?? new Date().toISOString();
  const limit = Math.min(args.limit ?? 5, 20);
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("service_id, price_total, status, services(name)")
    .eq("organization_id", orgId)
    .gte("start_at", from)
    .lte("start_at", to);
  if (error) throw new Error(error.message);
  const EXCLUDE = new Set(["cancelled_by_guest", "cancelled_by_provider", "no_show", "draft"]);
  const agg = new Map<string, { name: string; revenue: number; count: number }>();
  for (const b of data ?? []) {
    if (EXCLUDE.has(b.status as string)) continue;
    const name = (b as any).services?.name ?? "Ismeretlen";
    const cur = agg.get(b.service_id) ?? { name, revenue: 0, count: 0 };
    cur.revenue += Number(b.price_total || 0);
    cur.count += 1;
    agg.set(b.service_id, cur);
  }
  const top = [...agg.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
  return { from, to, top };
}

async function toolInactiveCustomers(orgId: string, args: { days?: number; limit?: number }) {
  const supabaseAdmin = await getAdminClient();
  const days = args.days ?? 90;
  const limit = Math.min(args.limit ?? 20, 100);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data: customers, error } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, email, phone, created_at")
    .eq("organization_id", orgId)
    .limit(2000);
  if (error) throw new Error(error.message);
  const { data: recent } = await supabaseAdmin
    .from("bookings")
    .select("customer_id, start_at")
    .eq("organization_id", orgId)
    .gte("start_at", cutoff);
  const activeIds = new Set((recent ?? []).map(b => b.customer_id).filter(Boolean));
  const { data: lastByCust } = await supabaseAdmin
    .from("bookings")
    .select("customer_id, start_at")
    .eq("organization_id", orgId)
    .order("start_at", { ascending: false })
    .limit(5000);
  const lastSeen = new Map<string, string>();
  for (const b of lastByCust ?? []) {
    if (!b.customer_id) continue;
    if (!lastSeen.has(b.customer_id)) lastSeen.set(b.customer_id, b.start_at);
  }
  const inactive = (customers ?? [])
    .filter(c => !activeIds.has(c.id) && lastSeen.has(c.id))
    .map(c => ({
      id: c.id,
      name: c.full_name,
      email: c.email,
      last_visit: lastSeen.get(c.id) ?? null,
    }))
    .sort((a, b) => (a.last_visit ?? "").localeCompare(b.last_visit ?? ""))
    .slice(0, limit);
  return { days, total_inactive: inactive.length, customers: inactive };
}

async function toolSuggestSlots(orgId: string, args: {
  service_id?: string; staff_profile_id?: string; date_from?: string; date_to?: string;
}) {
  const supabaseAdmin = await getAdminClient();
  const from = args.date_from ?? new Date().toISOString();
  const to = args.date_to ?? new Date(Date.now() + 7 * 86400000).toISOString();

  // pick a service
  let serviceId = args.service_id;
  let duration = 30;
  if (serviceId) {
    const { data: svc } = await supabaseAdmin
      .from("services").select("duration_minutes").eq("id", serviceId).maybeSingle();
    duration = svc?.duration_minutes ?? 30;
  } else {
    const { data: svc } = await supabaseAdmin
      .from("services").select("id, duration_minutes")
      .eq("organization_id", orgId).eq("active", true).limit(1).maybeSingle();
    serviceId = svc?.id;
    duration = svc?.duration_minutes ?? 30;
  }

  let staffQ = supabaseAdmin
    .from("staff_profiles")
    .select("id, display_name, working_hours_json")
    .eq("organization_id", orgId)
    .eq("active", true);
  if (args.staff_profile_id) staffQ = staffQ.eq("id", args.staff_profile_id);
  const { data: staffList } = await staffQ;
  const filtered = (staffList ?? []) as any[];

  const CANCELLED = new Set(["cancelled_by_guest", "cancelled_by_provider", "no_show"]);
  const { data: existingAll } = await supabaseAdmin
    .from("bookings")
    .select("staff_profile_id, start_at, end_at, status")
    .eq("organization_id", orgId)
    .gte("start_at", from)
    .lte("start_at", to);
  const existing = (existingAll ?? []).filter(b => !CANCELLED.has(b.status as string));

  const dayKeys = ["sun","mon","tue","wed","thu","fri","sat"];
  const suggestions: { staff: string; start: string; end: string }[] = [];
  const fromDate = new Date(from);
  const toDate = new Date(to);

  for (const s of filtered.slice(0, 5)) {
    const wh = s.working_hours_json || {};
    for (let d = new Date(fromDate); d < toDate && suggestions.length < 30; d = new Date(d.getTime() + 86400000)) {
      const dk = dayKeys[d.getDay()];
      const hours = wh[dk];
      if (!hours) continue;
      const [oh, om] = hours[0].split(":").map(Number);
      const [ch, cm] = hours[1].split(":").map(Number);
      const dayStart = new Date(d); dayStart.setHours(oh, om, 0, 0);
      const dayEnd = new Date(d); dayEnd.setHours(ch, cm, 0, 0);
      for (let t = new Date(dayStart); t.getTime() + duration * 60000 <= dayEnd.getTime(); t = new Date(t.getTime() + 30 * 60000)) {
        const slotEnd = new Date(t.getTime() + duration * 60000);
        const conflict = (existing ?? []).some(b =>
          b.staff_profile_id === s.id &&
          new Date(b.start_at) < slotEnd && new Date(b.end_at) > t
        );
        if (!conflict && t > new Date()) {
          suggestions.push({ staff: s.display_name, start: t.toISOString(), end: slotEnd.toISOString() });
          if (suggestions.length >= 30) break;
        }
      }
    }
  }
  return { service_id: serviceId, duration_minutes: duration, suggestions: suggestions.slice(0, 12) };
}

async function toolBottlenecks(orgId: string, args: { from?: string; to?: string }) {
  const supabaseAdmin = await getAdminClient();
  const from = args.from ?? new Date(Date.now() - 30 * 86400000).toISOString();
  const to = args.to ?? new Date().toISOString();
  const { data: bookings } = await supabaseAdmin
    .from("bookings")
    .select("staff_profile_id, service_id, start_at, end_at, status")
    .eq("organization_id", orgId)
    .gte("start_at", from)
    .lte("start_at", to);
  const { data: staff } = await supabaseAdmin
    .from("staff_profiles").select("id, display_name, working_hours_json")
    .eq("organization_id", orgId).eq("active", true);

  const utilization: { staff: string; booked_minutes: number; capacity_minutes: number; utilization_pct: number }[] = [];
  const dayKeys = ["sun","mon","tue","wed","thu","fri","sat"];
  const fromDate = new Date(from); const toDate = new Date(to);
  const EXCLUDE2 = new Set(["cancelled_by_guest", "cancelled_by_provider", "no_show", "draft"]);
  for (const s of staff ?? []) {
    let booked = 0;
    for (const b of bookings ?? []) {
      if (b.staff_profile_id !== s.id) continue;
      if (EXCLUDE2.has(b.status as string)) continue;
      booked += (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000;
    }
    let capacity = 0;
    const wh = (s as any).working_hours_json || {};
    for (let d = new Date(fromDate); d < toDate; d = new Date(d.getTime() + 86400000)) {
      const hours = wh[dayKeys[d.getDay()]];
      if (!hours) continue;
      const [oh, om] = hours[0].split(":").map(Number);
      const [ch, cm] = hours[1].split(":").map(Number);
      capacity += (ch * 60 + cm) - (oh * 60 + om);
    }
    utilization.push({
      staff: s.display_name,
      booked_minutes: Math.round(booked),
      capacity_minutes: capacity,
      utilization_pct: capacity > 0 ? Math.round((booked / capacity) * 100) : 0,
    });
  }
  utilization.sort((a, b) => b.utilization_pct - a.utilization_pct);

  // peak hours
  const hourCount: Record<number, number> = {};
  for (const b of bookings ?? []) {
    if (EXCLUDE2.has(b.status as string)) continue;
    const h = new Date(b.start_at).getHours();
    hourCount[h] = (hourCount[h] ?? 0) + 1;
  }
  const peakHours = Object.entries(hourCount)
    .map(([h, c]) => ({ hour: Number(h), count: c }))
    .sort((a, b) => b.count - a.count);

  return { from, to, utilization, peak_hours: peakHours };
}

// ---------- Tool definitions for the model ----------

const tools = [
  {
    type: "function",
    function: {
      name: "get_bookings_count",
      description: "Megadott időszak foglalásainak száma, státusz szerinti bontás, és napi idősor.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "ISO dátum-idő (kezdet)" },
          to: { type: "string", description: "ISO dátum-idő (vég)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_services_by_revenue",
      description: "Top szolgáltatások bevétel szerint az adott időszakban.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" }, to: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_inactive_customers",
      description: "Ügyfelek, akik N napja nem foglaltak (alapérték 90 nap).",
      parameters: {
        type: "object",
        properties: { days: { type: "number" }, limit: { type: "number" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_available_slots",
      description: "Szabad időpont javaslatok adott időszakban, opcionálisan szolgáltatás/munkatárs szerint.",
      parameters: {
        type: "object",
        properties: {
          service_id: { type: "string" },
          staff_profile_id: { type: "string" },
          date_from: { type: "string" },
          date_to: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_schedule_bottlenecks",
      description: "Munkatárs kihasználtság és csúcsidők azonosítása.",
      parameters: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
      },
    },
  },
];

async function runTool(orgId: string, name: string, args: any) {
  switch (name) {
    case "get_bookings_count": return await toolBookingsCount(orgId, args);
    case "get_top_services_by_revenue": return await toolTopServices(orgId, args);
    case "get_inactive_customers": return await toolInactiveCustomers(orgId, args);
    case "suggest_available_slots": return await toolSuggestSlots(orgId, args);
    case "get_schedule_bottlenecks": return await toolBottlenecks(orgId, args);
    default: return { error: `Ismeretlen tool: ${name}` };
  }
}

const SYSTEM = `Magyar nyelvű AI asszisztens vagy egy online foglalási rendszerben kis szolgáltató vállalkozások (szalonok, wellness, edzők, tanácsadók, oktatók, kisrendelők) számára.
Mindig a megadott tool-okat használd, ha az üzleti adatokra van szükség. Sose találj ki számokat.
A válaszod legyen tömör, magyar nyelvű, markdown formátumú. Ha számszerű eredmény van, foglalhatod össze listával vagy táblázattal.
Ha hasznos, illessz be EGY diagram blokkot pontosan ebben a formában (a UI ezt diagrammá renderelje):
\`\`\`chart
{"type":"bar","title":"...","x":"label","y":"value","data":[{"label":"H","value":3}, ...]}
\`\`\`
Támogatott chart típusok: "bar", "line", "pie". A data tömb objektumokat tartalmazzon, label/value mezőkkel.`;

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    await assertOrgAccess(context.userId, data.organizationId);
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY nincs beállítva.");

    const messages: any[] = [
      { role: "system", content: SYSTEM + `\nMai dátum: ${new Date().toISOString()}` },
      ...data.messages,
    ];

    for (let i = 0; i < 6; i++) {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          tools,
          tool_choice: "auto",
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        if (resp.status === 429) throw new Error("Túl sok kérés. Próbáld pár másodperc múlva.");
        if (resp.status === 402) throw new Error("Elfogyott a Lovable AI kredit. Tölts fel a workspace beállításokban.");
        throw new Error(`AI Gateway hiba (${resp.status}): ${text.slice(0, 200)}`);
      }
      const json: any = await resp.json();
      const msg = json.choices?.[0]?.message;
      if (!msg) throw new Error("Üres válasz az AI-tól.");
      messages.push(msg);
      const calls = msg.tool_calls;
      if (!calls || calls.length === 0) {
        return { reply: String(msg.content ?? "") };
      }
      for (const c of calls) {
        let args: any = {};
        try { args = JSON.parse(c.function?.arguments || "{}"); } catch {}
        let result: any;
        try { result = await runTool(data.organizationId, c.function?.name, args); }
        catch (e: any) { result = { error: e?.message || String(e) }; }
        messages.push({
          role: "tool",
          tool_call_id: c.id,
          content: JSON.stringify(result).slice(0, 8000),
        });
      }
    }
    return { reply: "Sajnos nem sikerült választ generálni (túl sok tool hívás)." };
  });
