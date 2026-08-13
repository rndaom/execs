import { and, count, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ulid } from "ulidx";
import { z } from "zod";
import { configs, reports } from "@/db/schema";
import { getDb } from "@/lib/cf";
import { getCurrentUser } from "@/lib/current-user";

const schema = z.object({
  configId: z.string().min(1),
  reason: z.enum(["malicious", "stolen", "not-tf2", "inappropriate-media", "other"]),
  detail: z.string().trim().max(2000).default(""),
});

const MAX_REPORTS_PER_DAY = 5;

export async function POST(request: Request) {
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid report" }, { status: 400 });

  const db = await getDb();
  const config = await db
    .select({ id: configs.id })
    .from(configs)
    .where(eq(configs.id, body.data.configId))
    .get();
  if (!config) return NextResponse.json({ error: "config not found" }, { status: 404 });

  const user = await getCurrentUser();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  if (user) {
    const dup = await db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.configId, config.id), eq(reports.reporterId, user.id)))
      .get();
    if ((dup?.n ?? 0) > 0) {
      return NextResponse.json({ error: "you already reported this config" }, { status: 429 });
    }
    const recent = await db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.reporterId, user.id), gt(reports.createdAt, dayAgo)))
      .get();
    if ((recent?.n ?? 0) >= MAX_REPORTS_PER_DAY) {
      return NextResponse.json({ error: "report limit reached — try tomorrow" }, { status: 429 });
    }
  } else {
    return NextResponse.json({ error: "sign in to report" }, { status: 401 });
  }

  await db.insert(reports).values({
    id: ulid(),
    configId: config.id,
    reporterId: user.id,
    reason: body.data.reason,
    detail: body.data.detail,
    createdAt: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
