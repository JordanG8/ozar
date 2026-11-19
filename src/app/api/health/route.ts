import { neon } from "@neondatabase/serverless";
import { getNeonAuth } from "@/lib/neon-auth";

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ ok: false }, { status: 403 });
  }

  const auth = getNeonAuth();
  const databaseUrl = process.env.DATABASE_URL;
  if (!auth || !databaseUrl) return Response.json({ ok: false }, { status: 503 });

  try {
    const session = await auth.getSession();
    if (!session.data?.user) return Response.json({ ok: false }, { status: 401 });

    const sql = neon(databaseUrl);
    const [, rows] = await sql.transaction([
      sql`INSERT INTO deployment_probe (id) VALUES ('phase-0')
          ON CONFLICT (id) DO UPDATE SET checked_at = now()`,
      sql`SELECT id FROM deployment_probe WHERE id = 'phase-0'`,
    ]);

    return Response.json({ ok: true, readBack: rows[0]?.id === "phase-0" });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
