import type { NextRequest } from "next/server";
import { getNeonAuth } from "@/lib/neon-auth";

export function proxy(request: NextRequest) {
  return getNeonAuth()?.middleware({ publicRoutes: ["/setup-check", "/learn", "/infinite", "/sessions", "/decks/import"] })(request);
}

export const config = {
  matcher: [
    {
      source: "/setup-check",
      has: [{ type: "query", key: "neon_auth_session_verifier" }],
    },
    {
      source: "/learn",
      has: [{ type: "query", key: "neon_auth_session_verifier" }],
    },
    {
      source: "/infinite",
      has: [{ type: "query", key: "neon_auth_session_verifier" }],
    },
    {
      source: "/sessions",
      has: [{ type: "query", key: "neon_auth_session_verifier" }],
    },
    {
      source: "/decks/import",
      has: [{ type: "query", key: "neon_auth_session_verifier" }],
    },
  ],
};
