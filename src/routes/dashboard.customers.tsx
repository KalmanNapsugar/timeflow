import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/dashboard/customers")({
  component: CustomersPage,
});

function CustomersPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];

  const { data: customers } = useQuery({
    queryKey: ["customers", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  if (!orgId) return <p className="text-muted-foreground">Először rendelj magadhoz egy szervezetet.</p>;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Ügyfelek</h1>
      <div className="space-y-2">
        {customers?.map((c: any) => (
          <Card key={c.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{c.full_name} {c.blacklisted && <Badge variant="destructive" className="ml-2">Tiltva</Badge>}</div>
              <div className="text-sm text-muted-foreground">{c.email} · {c.phone}</div>
            </div>
            <div className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString("hu-HU")}</div>
          </Card>
        ))}
        {(customers?.length ?? 0) === 0 && <p className="text-muted-foreground">Még nincsenek ügyfelek.</p>}
      </div>
    </div>
  );
}
