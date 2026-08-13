import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/cf";
import { buildSteamLoginUrl } from "@/lib/steam";

export async function GET() {
  const env = await getEnv();
  const state = crypto.randomUUID();

  (await cookies()).set("execs_oauth_state", state, {
    httpOnly: true,
    secure: env.APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 10 * 60,
  });

  redirect(
    buildSteamLoginUrl({
      openidBase: env.STEAM_OPENID_BASE,
      appUrl: env.APP_URL,
      state,
    }),
  );
}
