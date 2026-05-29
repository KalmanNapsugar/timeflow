import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Calendar, MessageSquare, TrendingUp, Users } from "lucide-react";

export const Route = createFileRoute("/dashboard/ai-assistant")({
  component: AIPage,
});

const FEATURES = [
  { icon: Calendar, title: "Intelligens időpont javaslat", desc: "Az ügyfél preferenciái és a naptári lyukak alapján a legjobb időpontokat ajánlja." },
  { icon: MessageSquare, title: "Automatikus ügyfél üzenetek", desc: "Megerősítések, emlékeztetők és visszatérítési kérelmek megválaszolása természetes nyelven." },
  { icon: TrendingUp, title: "Bevétel optimalizálás", desc: "Dinamikus árazás javaslatok kereslet és kihasználtság alapján." },
  { icon: Users, title: "Ügyfél szegmentáció", desc: "Automatikus címkézés viselkedés alapján: hűséges, kockázatos, alvó." },
];

function AIPage() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-3xl font-bold">AI asszisztens</h1>
        <Badge variant="secondary">Hamarosan</Badge>
      </div>
      <p className="text-muted-foreground text-sm mb-6">Mesterséges intelligencia funkciók az üzleted automatizálására.</p>

      <Card className="p-6 mb-6 bg-gradient-hero text-primary-foreground">
        <div className="flex items-start gap-4">
          <Sparkles className="w-8 h-8 shrink-0" />
          <div>
            <h2 className="text-xl font-semibold mb-1">Az AI asszisztens fejlesztés alatt áll</h2>
            <p className="text-sm opacity-90">
              Hamarosan elérhetővé válnak a Lovable AI Gateway-en futó funkciók, amelyek külön API kulcs nélkül azonnal használhatók lesznek.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {FEATURES.map(f => (
          <Card key={f.title} className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <f.icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-medium mb-1">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
