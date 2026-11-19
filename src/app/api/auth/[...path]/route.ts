import { getNeonAuth } from "@/lib/neon-auth";

export async function GET(request: Request, context: RouteContext<"/api/auth/[...path]">) {
  const auth = getNeonAuth();
  if (!auth) return Response.json({ error: "Auth is not configured." }, { status: 503 });
  return auth.handler().GET(request, context);
}

export async function POST(request: Request, context: RouteContext<"/api/auth/[...path]">) {
  const auth = getNeonAuth();
  if (!auth) return Response.json({ error: "Auth is not configured." }, { status: 503 });
  return auth.handler().POST(request, context);
}
