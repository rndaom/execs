import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { getEnv } from "./cf";

const COOKIE_NAME = "execs_session";
const SESSION_DAYS = 30;

export interface Session {
  /** users.id (ULID) */
  userId: string;
  steamId: string;
}

function secretKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function createSession(session: Session): Promise<void> {
  const env = await getEnv();
  const token = await new SignJWT({ steamId: session.steamId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey(env.SESSION_SECRET));

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const env = await getEnv();
    const { payload } = await jwtVerify(token, secretKey(env.SESSION_SECRET));
    if (typeof payload.sub !== "string" || typeof payload.steamId !== "string") return null;
    return { userId: payload.sub, steamId: payload.steamId };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}
