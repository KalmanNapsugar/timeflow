import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Mail } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Bejelentkezés" }] }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; email: string }>({
    open: false,
    email: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin, data: { full_name: name } }
        });
        if (error) throw error;
        // Visszaváltás a bejelentkezés nézetre + űrlap reset
        const registeredEmail = email;
        setConfirmDialog({ open: true, email: registeredEmail });
        setMode("signin");
        setPassword("");
        setName("");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="p-8 w-full max-w-md shadow-elegant">
        <h1 className="text-2xl font-bold mb-6">{mode === "signin" ? "Bejelentkezés" : "Regisztráció"}</h1>
        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <div><Label>Teljes név</Label><Input value={name} onChange={e => setName(e.target.value)} required /></div>
          )}
          <div><Label>E-mail</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
          <div><Label>Jelszó</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></div>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "..." : (mode === "signin" ? "Belépés" : "Regisztráció")}
          </Button>
        </form>
        <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-sm text-muted-foreground mt-4 hover:text-foreground">
          {mode === "signin" ? "Még nincs fiókod? Regisztrálj" : "Van fiókod? Jelentkezz be"}
        </button>
        <div className="mt-4"><Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Vissza</Link></div>
      </Card>

      <Dialog open={confirmDialog.open} onOpenChange={(o) => setConfirmDialog((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Mail className="w-7 h-7 text-primary" />
            </div>
            <DialogTitle className="text-center text-2xl">Ellenőrizd az e-mailedet</DialogTitle>
            <DialogDescription className="text-center text-base pt-2">
              Megerősítő levelet küldtünk a következő címre:
              <br />
              <span className="font-semibold text-foreground">{confirmDialog.email}</span>
              <br /><br />
              Kattints a levélben található linkre a fiókod aktiválásához, majd jelentkezz be itt.
              Ha pár percen belül nem érkezik meg, nézd meg a Spam mappát is.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="w-full" onClick={() => setConfirmDialog((s) => ({ ...s, open: false }))}>
              Rendben
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
