import { eq } from "drizzle-orm";
import { type User, users } from "@/db/schema";
import { getDb } from "./cf";
import { getSession } from "./session";

/** Session + user row in one call; null when signed out or user vanished. */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;
  const db = await getDb();
  const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user || user.isBanned) return null;
  return user;
}
