import type { User } from "@/db/schema";
import { getEnv } from "./cf";

/**
 * Admin = users.is_admin flag OR steam id listed in the ADMIN_STEAM_IDS env
 * var (comma-separated) — the bootstrap path for the first admin.
 */
export async function isAdmin(user: User | null): Promise<boolean> {
  if (!user) return false;
  if (user.isAdmin) return true;
  const env = await getEnv();
  const ids = (env as { ADMIN_STEAM_IDS?: string }).ADMIN_STEAM_IDS ?? "";
  return ids
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(user.steamId);
}
