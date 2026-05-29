import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/dashboard/audit-log")({
  component: AuditPage,
});

function AuditPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];

  const { data: logs } = useQuery({
    queryKey: ["audit", orgId], enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("audit_logs").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(200);
      return data ?? [];
    },
  });

  if (!orgId) return <p className="text-muted-foreground">Először hozz létre egy üzletet.</p>;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">Audit napló</h1>
      <p className="text-muted-foreground text-sm mb-6">Üzleti műveletek időrendi listája (utolsó 200 esemény).</p>

      <Card>
        {logs?.length === 0 ? (
          <p className="p-6 text-muted-foreground text-center">Még nincs napló bejegyzés.</p>
        ) : (
          <div className="divide-y">
            {logs?.map((l: any) => (
              <div key={l.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant="outline">{l.action}</Badge>
                  <span className="text-muted-foreground truncate">
                    {l.entity_type} {l.entity_id?.slice(0, 8)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {new Date(l.created_at).toLocaleString("hu-HU")}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
