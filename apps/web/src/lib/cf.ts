import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

export interface Env {
  DB: D1Database;
  R2_FILES: R2Bucket;
  R2_MEDIA: R2Bucket;
  APP_URL: string;
  SESSION_SECRET: string;
  STEAM_API_KEY?: string;
  // Test hook: point OpenID at a stub server. Defaults to real Steam.
  STEAM_OPENID_BASE?: string;
}

export async function getEnv(): Promise<Env> {
  const { env } = await getCloudflareContext({ async: true });
  return env as unknown as Env;
}

export async function getDb() {
  const env = await getEnv();
  return drizzle(env.DB, { schema });
}
