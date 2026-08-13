import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ulid } from "ulidx";
import { configs, media } from "@/db/schema";
import { getDb, getEnv } from "@/lib/cf";
import { getCurrentUser } from "@/lib/current-user";
import { extractYoutubeId } from "@/lib/youtube";

const MAX_MEDIA_PER_CONFIG = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function sniffImage(bytes: Uint8Array): { ext: string; mime: string } | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return { ext: "png", mime: "image/png" };
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

export async function POST(request: Request, ctx: { params: Promise<{ configId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const { configId } = await ctx.params;
  const db = await getDb();
  const config = await db.select().from(configs).where(eq(configs.id, configId)).get();
  if (!config) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (config.ownerId !== user.id) return NextResponse.json({ error: "not yours" }, { status: 403 });

  const existing = await db
    .select({ n: count() })
    .from(media)
    .where(eq(media.configId, configId))
    .get();
  if ((existing?.n ?? 0) >= MAX_MEDIA_PER_CONFIG) {
    return NextResponse.json({ error: `max ${MAX_MEDIA_PER_CONFIG} media items` }, { status: 422 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "expected form data" }, { status: 400 });

  const now = Date.now();
  const youtube = form.get("youtube");
  if (typeof youtube === "string" && youtube.trim()) {
    const id = extractYoutubeId(youtube.trim());
    if (!id) return NextResponse.json({ error: "unrecognized YouTube link" }, { status: 422 });
    const row = {
      id: ulid(),
      configId,
      uploaderId: user.id,
      type: "youtube" as const,
      youtubeId: id,
      sortOrder: existing?.n ?? 0,
      createdAt: now,
    };
    await db.insert(media).values(row);
    return NextResponse.json({ ok: true, id: row.id });
  }

  const image = form.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "provide an image file or youtube link" }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image exceeds 5MB" }, { status: 422 });
  }
  const bytes = new Uint8Array(await image.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed) {
    return NextResponse.json({ error: "only PNG/JPEG/WebP images" }, { status: 422 });
  }

  const env = await getEnv();
  const mediaId = ulid();
  const r2Key = `config-media/${configId}/${mediaId}.${sniffed.ext}`;
  await env.R2_MEDIA.put(r2Key, bytes as unknown as ArrayBuffer, {
    httpMetadata: { contentType: sniffed.mime },
  });
  await db.insert(media).values({
    id: mediaId,
    configId,
    uploaderId: user.id,
    type: "image",
    r2Key,
    sortOrder: existing?.n ?? 0,
    createdAt: now,
  });
  return NextResponse.json({ ok: true, id: mediaId });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ configId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { configId } = await ctx.params;
  const { mediaId } = (await request.json().catch(() => ({}))) as { mediaId?: string };
  if (!mediaId) return NextResponse.json({ error: "mediaId required" }, { status: 400 });

  const db = await getDb();
  const config = await db.select().from(configs).where(eq(configs.id, configId)).get();
  if (!config) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (config.ownerId !== user.id) return NextResponse.json({ error: "not yours" }, { status: 403 });

  const row = await db.select().from(media).where(eq(media.id, mediaId)).get();
  if (!row || row.configId !== configId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (row.r2Key) {
    const env = await getEnv();
    await env.R2_MEDIA.delete(row.r2Key);
  }
  await db.delete(media).where(eq(media.id, mediaId));
  return NextResponse.json({ ok: true });
}
