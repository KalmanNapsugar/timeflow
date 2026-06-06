type LovableErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
  }
}

export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const payload = {
    source: "react_error_boundary",
    route: window.location.pathname,
    message,
    stack,
    ...context,
  };
  console.error("[app-error-boundary]", payload);
  window.__lovableEvents?.captureException?.(
    error,
    payload,
    {
      mechanism: "react_error_boundary",
      handled: false,
      severity: "error",
    },
  );
}
