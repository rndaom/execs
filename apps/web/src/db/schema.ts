import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const CATEGORIES = [
  "full-setup",
  "class-config",
  "graphics",
  "network",
  "binds",
  "scripts",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const configs = sqliteTable(
  "configs",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    category: text("category", { enum: CATEGORIES }).notNull(),
    status: text("status", { enum: ["published", "withheld", "removed"] })
      .notNull()
      .default("published"),
    latestVersionId: text("latest_version_id"),
    downloadCount: integer("download_count").notNull().default(0),
    installCount: integer("install_count").notNull().default(0),
    previewTier: text("preview_tier"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("configs_status_created").on(t.status, t.createdAt),
    index("configs_status_downloads").on(t.status, t.downloadCount),
    index("configs_category").on(t.category),
  ],
);

export const configVersions = sqliteTable(
  "config_versions",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => configs.id),
    versionLabel: text("version_label").notNull(),
    changelogMd: text("changelog_md").notNull().default(""),
    lintReportJson: text("lint_report_json").notNull(),
    lintStatus: text("lint_status", { enum: ["clean", "warnings"] }).notNull(),
    metadataJson: text("metadata_json").notNull(),
    previewKeyJson: text("preview_key_json"),
    zipR2Key: text("zip_r2_key").notNull(),
    totalSizeBytes: integer("total_size_bytes").notNull(),
    fileCount: integer("file_count").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("versions_config").on(t.configId)],
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => configVersions.id),
    installPath: text("install_path").notNull(),
    r2Key: text("r2_key").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    kind: text("kind", { enum: ["cfg", "txt", "other"] }).notNull(),
  },
  (t) => [index("files_version").on(t.versionId)],
);

export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => configs.id),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => users.id),
    type: text("type", { enum: ["image", "youtube"] }).notNull(),
    r2Key: text("r2_key"),
    youtubeId: text("youtube_id"),
    width: integer("width"),
    height: integer("height"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("media_config").on(t.configId)],
);

export const configClasses = sqliteTable(
  "config_classes",
  {
    configId: text("config_id")
      .notNull()
      .references(() => configs.id),
    class: text("class").notNull(),
  },
  (t) => [primaryKey({ columns: [t.configId, t.class] })],
);

export const downloadEvents = sqliteTable(
  "download_events",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id").notNull(),
    kind: text("kind", { enum: ["zip", "direct_install"] }).notNull(),
    ipHash: text("ip_hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("events_version").on(t.versionId), index("events_created").on(t.createdAt)],
);

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => configs.id),
    reporterId: text("reporter_id"),
    reason: text("reason", {
      enum: ["malicious", "stolen", "not-tf2", "inappropriate-media", "other"],
    }).notNull(),
    detail: text("detail").notNull().default(""),
    status: text("status", { enum: ["open", "resolved", "dismissed"] })
      .notNull()
      .default("open"),
    createdAt: integer("created_at").notNull(),
    resolvedBy: text("resolved_by"),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [index("reports_status").on(t.status)],
);

export type Config = typeof configs.$inferSelect;
export type ConfigVersion = typeof configVersions.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
