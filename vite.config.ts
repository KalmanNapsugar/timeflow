// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      // The generated browser client has SSR fallbacks that reference process.env.
      // Replace only the public fallback keys so browser bundles do not evaluate
      // `process`, while server-only secrets like SERVICE_ROLE_KEY remain runtime env vars.
      "process.env.SUPABASE_URL": JSON.stringify(
        process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
      ),
      "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
      ),
      __PUBLIC_SUPABASE_URL__: JSON.stringify(
        process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
      ),
      __PUBLIC_SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      ),
    },
  },
});
