import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { createOrganization } from "@/lib/orgs.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Store } from "lucide-react";

export const Route = createFileRoute("/organizations/new")({
  head: () => ({ meta: [{ title: "Új üzlet regisztrálása" }] }),
  component: NewOrgPage,
});

function slugify(s: string) {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function NewOrgPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const createFn = useServerFn(createOrganization);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await createFn({ data: { name, slug, description: description || null } });
      toast.success("Üzlet létrehozva!");
      navigate({ to: "/dashboard" });
      void res;
    } catch (err: any) {
      toast.error(err.message ?? "Hiba történt");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-10">Betöltés…</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4">
          <ArrowLeft className="w-3 h-3" /> Vissza
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-lg bg-gradient-hero flex items-center justify-center">
            <Store className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Új üzlet regisztrálása</h1>
            <p className="text-sm text-muted-foreground">
              Hozd létre saját üzletedet, és kezeld a szolgáltatásaidat, alkalmazottaidat, foglalásaidat.
            </p>
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Üzlet neve *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Pl. Kati Fodrászat" required minLength={2} maxLength={120} />
            </div>
            <div>
              <Label htmlFor="slug">URL azonosító (slug) *</Label>
              <Input id="slug" value={slug}
                onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
                placeholder="kati-fodraszat" required minLength={2} maxLength={60}
                pattern="[a-z0-9-]+" />
              <p className="text-xs text-muted-foreground mt-1">
                Nyilvános oldal: <code>/provider/{slug || "..."}</code>
              </p>
            </div>
            <div>
              <Label htmlFor="description">Leírás</Label>
              <Textarea id="description" value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Rövid leírás az üzletről…" maxLength={500} rows={3} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy || !name || !slug}>
                {busy ? "Létrehozás…" : "Üzlet létrehozása"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/dashboard">Mégse</Link>
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-4 mt-4 bg-muted/30 text-sm text-muted-foreground">
          <p><strong>Mi történik a létrehozás után?</strong></p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Te leszel az üzlet tulajdonosa (owner szerepkör).</li>
            <li>A <Link to="/dashboard" className="underline">Vezérlőpulton</Link> kezelheted szolgáltatásaidat, munkatársaidat, ügyfeleidet és a naptárt.</li>
            <li>Az üzlet nyilvánosan elérhetővé válik az <code>/provider/{slug || "slug"}</code> URL-en, ahol az ügyfelek foglalhatnak.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
