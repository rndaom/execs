import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cf";

/** Same-origin reads from the media bucket (uploader images, preview matrix). */
export async function GET(_request: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const env = await getEnv();
  const object = await env.R2_MEDIA.get(key.join("/"));
  if (!object) return NextResponse.json({ error: "not found" }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers as unknown as Headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(object.body as unknown as BodyInit, { headers });
}
