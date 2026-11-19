import { getNeonAuth } from "@/lib/neon-auth";

async function deletionEndpoint(context: RouteContext<"/api/auth/[...path]">) {
  return (await context.params).path[0] === "delete-user";
}

export async function GET(request: Request, context: RouteContext<"/api/auth/[...path]">) {
  if (await deletionEndpoint(context)) return Response.json({ error: "not_found" }, { status: 404 });
  const auth = getNeonAuth();
  if (!auth) return Response.json({ error: "Auth is not configured." }, { status: 503 });
  return auth.handler().GET(request, context);
}

export async function POST(request: Request, context: RouteContext<"/api/auth/[...path]">) {
  if (await deletionEndpoint(context)) return Response.json({ error: "not_found" }, { status: 404 });
  const auth = getNeonAuth();
  if (!auth) return Response.json({ error: "Auth is not configured." }, { status: 503 });
  return auth.handler().POST(request, context);
}
