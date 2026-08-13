import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { configs, configVersions, files } from "@/db/schema";
import { getDb } from "@/lib/cf";
import type { VersionManifest } from "@/install/types";

export async function GET(_request: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await ctx.params;
  const db = await getDb();
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
  const rows = await db.select().from(files).where(eq(files.versionId, versionId)).all();
  const manifest: VersionManifest = {
    configId: config.id,
    versionId,
    name: config.name,
    versionLabel: version.versionLabel,
    files: rows.map((f) => ({ installPath: f.installPath, r2Key: f.r2Key, sha256: f.sha256 })),
  };
  return NextResponse.json(manifest);
}
