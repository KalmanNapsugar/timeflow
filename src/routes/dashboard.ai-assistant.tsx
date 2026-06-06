import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { askAssistant } from "@/lib/ai-assistant.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Send, Bot, User as UserIcon, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

export const Route = createFileRoute("/dashboard/ai-assistant")({
  component: AIPage,
});

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Hány foglalásom volt ezen a héten?",
  "Mely szolgáltatások generálják a legnagyobb bevételt az elmúlt 30 napban?",
  "Mely ügyfelek nem tértek vissza 90 napja?",
  "Javasolj szabad időpontokat a következő 7 napra.",
  "Hol vannak a beosztásom szűk keresztmetszetei?",
];

const CHART_COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2, 200 80% 55%))", "hsl(var(--chart-3, 30 90% 55%))", "hsl(var(--chart-4, 280 70% 60%))", "hsl(var(--chart-5, 140 60% 50%))"];

function ChartBlock({ raw }: { raw: string }) {
  let spec: any;
  try { spec = JSON.parse(raw); } catch { return <pre className="text-xs bg-muted p-2 rounded">{raw}</pre>; }
  const data = Array.isArray(spec.data) ? spec.data : [];
  if (data.length === 0) return null;
  const type = spec.type ?? "bar";
  return (
    <div className="my-3 p-3 border rounded-lg bg-card">
      {spec.title && <div className="text-sm font-medium mb-2">{spec.title}</div>}
      <div className="w-full h-56">
        <ResponsiveContainer width="100%" height="100%">
          {type === "line" ? (
            <LineChart data={data}>
              <XAxis dataKey="label" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2} />
            </LineChart>
          ) : type === "pie" ? (
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={80} label>
                {data.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          ) : (
            <BarChart data={data}>
              <XAxis dataKey="label" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function renderContent(content: string) {
  // Split on ```chart blocks
  const parts: { kind: "md" | "chart"; text: string }[] = [];
  const re = /```chart\s*\n([\s\S]*?)```/g;
  let last = 0; let m;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push({ kind: "md", text: content.slice(last, m.index) });
    parts.push({ kind: "chart", text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ kind: "md", text: content.slice(last) });
  return parts.map((p, i) => p.kind === "chart"
    ? <ChartBlock key={i} raw={p.text} />
    : <div key={i} className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown>{p.text}</ReactMarkdown>
      </div>
  );
}

function AIPage() {
  const { ownedOrgIds, viewingOrgId } = useAuth();
  const orgId = viewingOrgId || ownedOrgIds[0];
  const ask = useServerFn(askAssistant);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!orgId) { toast.error("Nincs kiválasztott üzlet."); return; }
    if (!text.trim() || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await ask({ data: { organizationId: orgId, messages: next } });
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (e: any) {
      toast.error(e?.message || "Hiba az AI hívás közben.");
      setMessages(next);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[900px]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-gradient-hero flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">AI asszisztens <Badge variant="secondary">béta</Badge></h1>
          <p className="text-sm text-muted-foreground">Kérdezd az üzleted adatairól természetes nyelven.</p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <Bot className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground mb-4">Miben segíthetek? Próbáld ezeket:</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-2xl mx-auto">
                {SUGGESTIONS.map(s => (
                  <Button key={s} variant="outline" size="sm" className="text-xs h-auto py-2 whitespace-normal text-left"
                    onClick={() => send(s)} disabled={loading}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {m.role === "user" ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className={`flex-1 max-w-[85%] ${m.role === "user" ? "text-right" : ""}`}>
                <div className={`inline-block text-left rounded-lg px-3 py-2 ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.role === "user"
                    ? <div className="whitespace-pre-wrap text-sm">{m.content}</div>
                    : <div>{renderContent(m.content)}</div>}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"><Bot className="w-4 h-4" /></div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Gondolkodom és adatokat lekérek…
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="border-t p-3 flex gap-2"
        >
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Pl. Hány foglalásom volt a múlt héten?"
            disabled={loading || !orgId}
          />
          <Button type="submit" disabled={loading || !input.trim() || !orgId}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </Card>

      {!orgId && (
        <p className="text-sm text-muted-foreground mt-3 text-center">
          Az AI asszisztens használatához válassz vagy hozz létre egy üzletet.
        </p>
      )}
    </div>
  );
}
