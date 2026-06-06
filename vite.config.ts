// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

const PUBLIC_SUPABASE_URL = "https://mjlezicsxkwrbzcoljpk.supabase.co";
const PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_yE_icLVBhPuGOueW7FXzHw_bY8Pk941";
const loadedEnv = {
  ...loadEnv("development", process.cwd(), ""),
  ...loadEnv("production", process.cwd(), ""),
  ...process.env,
};
const publicUrl = loadedEnv.VITE_SUPABASE_URL || loadedEnv.SUPABASE_URL || PUBLIC_SUPABASE_URL;
const publicKey =
  loadedEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  loadedEnv.SUPABASE_PUBLISHABLE_KEY ||
  PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
      "process.env.SUPABASE_URL": JSON.stringify(publicUrl),
      "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(publicKey),
      __PUBLIC_SUPABASE_URL__: JSON.stringify(publicUrl),
      __PUBLIC_SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(publicKey),
    },
  },
});
