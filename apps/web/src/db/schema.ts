import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Timestamps are unix milliseconds. IDs are ULIDs (sortable text).

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  steamId: text("steam_id").notNull().unique(),
  personaName: text("persona_name").notNull(),
  avatarUrl: text("avatar_url"),
  profileUrl: text("profile_url"),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  isBanned: integer("is_banned", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  lastLoginAt: integer("last_login_at").notNull(),
  personaRefreshedAt: integer("persona_refreshed_at").notNull(),
});

export type User = typeof users.$inferSelect;
