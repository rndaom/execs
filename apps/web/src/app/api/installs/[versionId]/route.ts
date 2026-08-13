import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ulid } from "ulidx";
import { configs, configVersions, downloadEvents } from "@/db/schema";
import { getDb } from "@/lib/cf";

export async function POST(request: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await ctx.params;
  const db = await getDb();
  const version = await db
    .select()
    .from(configVersions)
    .where(eq(configVersions.id, versionId))
    .get();
  if (!version) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${day}:${ip}`),
  );
  const ipHash = [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await db.batch([
    db.insert(downloadEvents).values({
      id: ulid(),
      versionId,
      kind: "direct_install",
      ipHash,
      createdAt: Date.now(),
    }),
    db
      .update(configs)
      .set({ installCount: sql`${configs.installCount} + 1` })
      .where(eq(configs.id, version.configId)),
  ]);
  return NextResponse.json({ ok: true });
}
