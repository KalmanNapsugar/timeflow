import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { RoleImpersonator } from "@/components/RoleImpersonator";
import { RouteGuard } from "@/components/RouteGuard";

declare const __PUBLIC_SUPABASE_URL__: string;
declare const __PUBLIC_SUPABASE_PUBLISHABLE_KEY__: string;

function getSupabaseConfigError() {
  const missing = [
    ...(!__PUBLIC_SUPABASE_URL__ ? ["VITE_SUPABASE_URL"] : []),
    ...(!__PUBLIC_SUPABASE_PUBLISHABLE_KEY__ ? ["VITE_SUPABASE_PUBLISHABLE_KEY"] : []),
  ];
  return missing.length
    ? `Missing Lovable Cloud configuration: ${missing.join(", ")}.`
    : null;
}

function ConfigurationError({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-lg text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          App configuration is missing
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const isLocalPreview =
    typeof window !== "undefined" &&
    (window.location.hostname.includes("lovable.app") ||
      window.location.hostname.includes("lovableproject.com") ||
      window.location.hostname.includes("localhost"));
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    // Vite dev-server restarts invalidate client chunks. The browser then fails to
    // dynamically import the (now stale) virtual entry. Auto-reload once to recover.
    const msg = `${error?.message ?? ""} ${error?.stack ?? ""}`;
    const isStaleChunk =
      /Failed to fetch dynamically imported module/i.test(msg) ||
      /Importing a module script failed/i.test(msg) ||
      /error loading dynamically imported module/i.test(msg);
    if (isStaleChunk && typeof window !== "undefined") {
      const KEY = "__lovable_stale_chunk_reload";
      const last = Number(sessionStorage.getItem(KEY) ?? "0");
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        {isLocalPreview && (
          <pre className="mt-4 max-h-48 overflow-auto rounded-md border bg-muted p-3 text-left text-xs text-muted-foreground">
            {error.stack ?? error.message}
          </pre>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lovable App" },
      { name: "description", content: "Lovable Generated Project" },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Lovable App" },
      { property: "og:description", content: "Lovable Generated Project" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { pathname } = useLocation();
  const configError = getSupabaseConfigError();
  // Dashboard and admin have their own dedicated layouts/sidebars.
  const hideHeader = pathname.startsWith("/dashboard") || pathname.startsWith("/admin");

  if (configError) return <ConfigurationError message={configError} />;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouteGuard />
        {!hideHeader && <SiteHeader />}
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster />
        <RoleImpersonator />
      </AuthProvider>
    </QueryClientProvider>
  );
}
