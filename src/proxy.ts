import type { NextRequest } from "next/server";
import { getNeonAuth } from "@/lib/neon-auth";

export function proxy(request: NextRequest) {
  return getNeonAuth()?.middleware({ publicRoutes: ["/setup-check"] })(request);
}

export const config = {
  matcher: [
    {
      source: "/setup-check",
      has: [{ type: "query", key: "neon_auth_session_verifier" }],
    },
  ],
};
