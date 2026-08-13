import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ulid } from "ulidx";
import { configs, configVersions, downloadEvents } from "@/db/schema";
import { getDb, getEnv } from "@/lib/cf";

async function hashIp(ip: string): Promise<string> {
  // Daily-salted so events can rate-limit without storing raw IPs.
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${day}:${ip}`),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function GET(request: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await ctx.params;
  const db = await getDb();
  const env = await getEnv();

  const version = await db
    .select()
    .from(configVersions)
    .where(eq(configVersions.id, versionId))
    .get();
  if (!version) return NextResponse.json({ error: "not found" }, { status: 404 });

  const config = await db.select().from(configs).where(eq(configs.id, version.configId)).get();
  if (!config || config.status === "removed") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const object = await env.R2_FILES.get(version.zipR2Key);
  if (!object) return NextResponse.json({ error: "file missing" }, { status: 404 });

  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const ipHash = await hashIp(ip);
  await db.batch([
    db.insert(downloadEvents).values({
      id: ulid(),
      versionId,
      kind: "zip",
      ipHash,
      createdAt: Date.now(),
    }),
    db
      .update(configs)
      .set({ downloadCount: sql`${configs.downloadCount} + 1` })
      .where(eq(configs.id, config.id)),
  ]);

  const filename = `${config.slug}-v${version.versionLabel}.zip`;
  return new Response(object.body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
