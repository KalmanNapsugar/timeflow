import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
        toast.success("Sikeres regisztráció! Ellenőrizd az e-mailt.");
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
    </div>
  );
}
