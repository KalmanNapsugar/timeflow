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
      // The generated browser client has an SSR fallback that references process.env.
      // If VITE_* injection is briefly unavailable in preview, this keeps the browser
      // from crashing with `process is not defined` while only exposing public values.
      "process.env.SUPABASE_URL": "import.meta.env.VITE_SUPABASE_URL",
      "process.env.SUPABASE_PUBLISHABLE_KEY": "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY",
    },
  },
});
