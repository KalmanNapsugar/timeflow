import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { listMyInvitations, respondInvitation } from "@/lib/staff.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profilom" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, loading, effectiveRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchInvites = useServerFn(listMyInvitations);
  const respond = useServerFn(respondInvitation);

  useEffect(() => { if (!loading && !user) navigate({ to: "/login" }); }, [loading, user, navigate]);

  const { data: invites, isLoading } = useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => fetchInvites(),
    enabled: !!user,
  });

  const m = useMutation({
    mutationFn: (vars: { id: string; accept: boolean }) =>
      respond({ data: { invitationId: vars.id, accept: vars.accept } }),
    onSuccess: (_d, vars) => {
      toast.success(vars.accept ? "Meghívás elfogadva" : "Meghívás elutasítva");
      qc.invalidateQueries({ queryKey: ["my-invitations"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (loading || !user) return <div className="p-10">Betöltés…</div>;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3">
          <ArrowLeft className="w-3 h-3" /> Vissza
        </Link>
        <h1 className="text-2xl font-bold mb-6">Profilom</h1>

        <Card className="p-5 mb-6">
          <h2 className="font-semibold mb-3">Alapadatok</h2>
          <dl className="text-sm grid grid-cols-[120px_1fr] gap-y-2">
            <dt className="text-muted-foreground">E-mail</dt><dd>{user.email}</dd>
            <dt className="text-muted-foreground">Szerepkör</dt><dd><Badge variant="outline">{effectiveRole}</Badge></dd>
            <dt className="text-muted-foreground">User ID</dt><dd className="font-mono text-xs">{user.id}</dd>
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-3">Függő alkalmazotti meghívások</h2>
          {isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
          {!isLoading && (invites?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">Nincs függő meghívásod.</p>
          )}
          <div className="space-y-2">
            {invites?.map(inv => (
              <div key={inv.id} className="flex items-center justify-between border rounded-md p-3">
                <div>
                  <div className="font-medium">{inv.organization?.name ?? "Ismeretlen üzlet"}</div>
                  <div className="text-xs text-muted-foreground">
                    Meghívva: {new Date(inv.created_at).toLocaleString("hu-HU")}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => m.mutate({ id: inv.id, accept: true })} disabled={m.isPending}>
                    <Check className="w-4 h-4 mr-1" /> Elfogadom
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => m.mutate({ id: inv.id, accept: false })} disabled={m.isPending}>
                    <X className="w-4 h-4 mr-1" /> Elutasítom
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
