import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Pencil, Plus, Trash2, Mail, UserMinus, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  inviteStaff, listOrgInvitations, listOrgMembers, listStaffProfiles,
  revokeInvitation, removeStaffMember,
} from "@/lib/staff.functions";

export const Route = createFileRoute("/dashboard/staff")({
  component: StaffPage,
});

type Form = { id?: string; display_name: string; bio: string; active: boolean };
const empty: Form = { display_name: "", bio: "", active: true };

function StaffPage() {
  const { ownedOrgIds } = useAuth();
  const orgId = ownedOrgIds[0];
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);

  const invite = useServerFn(inviteStaff);
  const fetchInvites = useServerFn(listOrgInvitations);
  const fetchMembers = useServerFn(listOrgMembers);
  const revoke = useServerFn(revokeInvitation);
  const removeMember = useServerFn(removeStaffMember);

  const [inviteEmail, setInviteEmail] = useState("");

  const { data: staff } = useQuery({
    queryKey: ["staff", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("staff_profiles").select("*").eq("organization_id", orgId!).order("created_at");
      return data ?? [];
    },
  });

  const { data: members } = useQuery({
    queryKey: ["org-members", orgId],
    enabled: !!orgId,
    queryFn: () => fetchMembers({ data: { organizationId: orgId! } }),
  });

  const { data: invitations } = useQuery({
    queryKey: ["org-invitations", orgId],
    enabled: !!orgId,
    queryFn: () => fetchInvites({ data: { organizationId: orgId! } }),
  });

  const save = useMutation({
    mutationFn: async (f: Form) => {
      if (f.id) {
        const { error } = await supabase.from("staff_profiles").update({ display_name: f.display_name, bio: f.bio, active: f.active }).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("staff_profiles").insert({ organization_id: orgId!, display_name: f.display_name, bio: f.bio, active: f.active });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Mentve"); setOpen(false); setForm(empty); qc.invalidateQueries({ queryKey: ["staff", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_profiles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Törölve"); qc.invalidateQueries({ queryKey: ["staff", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const sendInvite = useMutation({
    mutationFn: () => invite({ data: { organizationId: orgId!, email: inviteEmail } }),
    onSuccess: () => {
      toast.success("Meghívás elküldve");
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["org-invitations", orgId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const revokeM = useMutation({
    mutationFn: (id: string) => revoke({ data: { invitationId: id } }),
    onSuccess: () => { toast.success("Visszavonva"); qc.invalidateQueries({ queryKey: ["org-invitations", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const removeM = useMutation({
    mutationFn: (id: string) => removeMember({ data: { memberId: id } }),
    onSuccess: () => { toast.success("Eltávolítva"); qc.invalidateQueries({ queryKey: ["org-members", orgId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!orgId) return <p className="text-muted-foreground">Először rendelj magadhoz egy szervezetet.</p>;

  return (
    <div className="space-y-8">
      {/* Csapat (org_members) */}
      <section>
        <h1 className="text-3xl font-bold mb-4">Csapat</h1>
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Aktív tagok</h2>
          {(members?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">Még nincs csapattag (rajtad kívül).</p>}
          <div className="space-y-2">
            {members?.map(m => (
              <div key={m.id} className="flex items-center justify-between border rounded-md p-3">
                <div>
                  <div className="text-sm font-medium">{m.email}</div>
                  <div className="text-xs text-muted-foreground"><Badge variant="outline">{m.role}</Badge> {!m.active && <span className="ml-2">inaktív</span>}</div>
                </div>
                {m.role !== "owner" && (
                  <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Eltávolítod: ${m.email}?`)) removeM.mutate(m.id); }}>
                    <UserMinus className="w-4 h-4 mr-1" /> Eltávolítás
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 mt-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Mail className="w-4 h-4" /> Meghívás</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Add meg egy <strong>már regisztrált felhasználó</strong> e-mail címét. A meghívást ő a saját profil oldalán fogadhatja el.
          </p>
          <div className="flex gap-2 max-w-md">
            <Input type="email" placeholder="email@példa.hu" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
            <Button onClick={() => sendInvite.mutate()} disabled={!inviteEmail || sendInvite.isPending}>Meghívás küldése</Button>
          </div>

          {(invitations?.length ?? 0) > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-sm font-medium">Meghívások előzménye</div>
              {invitations?.map(i => (
                <div key={i.id} className="flex items-center justify-between text-sm border rounded-md p-2">
                  <div>
                    <span className="font-medium">{i.invited_email}</span>
                    <Badge variant="outline" className="ml-2">{i.status}</Badge>
                    <span className="text-xs text-muted-foreground ml-2">{new Date(i.created_at).toLocaleString("hu-HU")}</span>
                  </div>
                  {i.status === "pending" && (
                    <Button variant="ghost" size="sm" onClick={() => revokeM.mutate(i.id)}>
                      <XCircle className="w-4 h-4 mr-1" /> Visszavon
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* Munkatárs profilok (foglaláshoz kötött szakember kártyák) */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Munkatárs profilok</h2>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(empty); }}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Új</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{form.id ? "Szerkesztés" : "Új munkatárs profil"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Név</Label><Input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} /></div>
                <div><Label>Bemutatkozás</Label><Textarea value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Aktív</label>
                <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.display_name} className="w-full">Mentés</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="space-y-2">
          {staff?.map((s: any) => (
            <Card key={s.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{s.display_name} {!s.active && <span className="text-xs text-muted-foreground">(inaktív)</span>}</div>
                <div className="text-sm text-muted-foreground line-clamp-1">{s.bio}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="icon" onClick={() => { setForm({ id: s.id, display_name: s.display_name, bio: s.bio ?? "", active: s.active }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => { if (confirm("Biztos?")) del.mutate(s.id); }}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </Card>
          ))}
          {(staff?.length ?? 0) === 0 && <p className="text-muted-foreground">Még nincs munkatárs profil.</p>}
        </div>
      </section>
    </div>
  );
}
