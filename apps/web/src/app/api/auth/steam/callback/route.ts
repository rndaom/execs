import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { ulid } from "ulidx";
import { users } from "@/db/schema";
import { getDb, getEnv } from "@/lib/cf";
import { createSession } from "@/lib/session";
import { fetchSteamProfile, verifySteamAssertion } from "@/lib/steam";

const PERSONA_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const env = await getEnv();
  const params = request.nextUrl.searchParams;

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("execs_oauth_state")?.value;
  cookieStore.delete("execs_oauth_state");
  if (!expectedState || params.get("state") !== expectedState) {
    redirect("/?auth=state-mismatch");
  }

  const steamId = await verifySteamAssertion(params, env.STEAM_OPENID_BASE);
  if (!steamId) {
    redirect("/?auth=failed");
  }

  const db = await getDb();
  const now = Date.now();
  const existing = await db.select().from(users).where(eq(users.steamId, steamId)).get();

  let userId: string;
  if (existing) {
    if (existing.isBanned) redirect("/?auth=banned");
    userId = existing.id;
    const staleProfile = now - existing.personaRefreshedAt > PERSONA_TTL_MS;
    if (staleProfile) {
      const profile = await fetchSteamProfile(steamId, env.STEAM_API_KEY);
      await db
        .update(users)
        .set({
          personaName: profile.personaName,
          avatarUrl: profile.avatarUrl,
          profileUrl: profile.profileUrl,
          lastLoginAt: now,
          personaRefreshedAt: now,
        })
        .where(eq(users.id, userId));
    } else {
      await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, userId));
    }
  } else {
    const profile = await fetchSteamProfile(steamId, env.STEAM_API_KEY);
    userId = ulid();
    await db.insert(users).values({
      id: userId,
      steamId,
      personaName: profile.personaName,
      avatarUrl: profile.avatarUrl,
      profileUrl: profile.profileUrl,
      createdAt: now,
      lastLoginAt: now,
      personaRefreshedAt: now,
    });
  }

  await createSession({ userId, steamId });
  redirect("/");
}
