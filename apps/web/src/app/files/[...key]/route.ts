import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cf";

/** Same-origin reads from the files bucket (direct-install payload fetches). */
export async function GET(_request: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const env = await getEnv();
  const object = await env.R2_FILES.get(key.join("/"));
  if (!object) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new Response(object.body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
