import { type CfgFile, lint } from "@execs/cfglint";
import { matchPreview } from "@execs/preview-matrix";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ulid } from "ulidx";
import { z } from "zod";
import { CATEGORIES, configClasses, configs, configVersions, files } from "@/db/schema";
import { getDb, getEnv } from "@/lib/cf";
import { getCurrentUser } from "@/lib/current-user";
import {
  buildBundleZip,
  defaultInstallPath,
  expandUpload,
  sha256Hex,
  slugify,
  UploadError,
  type UploadedFile,
} from "@/lib/upload";

const metadataSchema = z.object({
  name: z.string().trim().min(3).max(80),
  summary: z.string().trim().min(10).max(200),
  description: z.string().trim().max(20000).default(""),
  category: z.enum(CATEGORIES),
  versionLabel: z.string().trim().min(1).max(20).default("1.0"),
  changelog: z.string().trim().max(5000).default(""),
  /** Present when uploading a new version of an existing config. */
  configId: z.string().optional(),
});

/** Warn clusters that need human eyes before publishing (moderation plan). */
function shouldWithhold(warnCount: number, ruleIds: Set<string>): boolean {
  return warnCount >= 3 || ruleIds.has("mouse-tamper") || ruleIds.has("chat-bind");
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "sign in to upload" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });
  }

  const parsedMeta = metadataSchema.safeParse({
    name: form.get("name"),
    summary: form.get("summary"),
    description: form.get("description") ?? "",
    category: form.get("category"),
    versionLabel: form.get("versionLabel") ?? "1.0",
    changelog: form.get("changelog") ?? "",
    configId: form.get("configId") ?? undefined,
  });
  if (!parsedMeta.success) {
    return NextResponse.json(
      { error: "invalid metadata", issues: parsedMeta.error.issues },
      { status: 400 },
    );
  }
  const meta = parsedMeta.data;

  const inputs: UploadedFile[] = [];
  for (const value of form.getAll("files")) {
    if (value instanceof File) {
      inputs.push({ name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) });
    }
  }

  try {
    const expanded = expandUpload(inputs);

    // ---- lint gate ----------------------------------------------------------
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const cfgFiles: CfgFile[] = expanded
      .filter((f) => f.name.toLowerCase().endsWith(".cfg"))
      .map((f) => ({ path: f.name, text: decoder.decode(f.bytes) }));
    const lintResult = lint(cfgFiles);
    const blocks = lintResult.findings.filter((f) => f.tier === "block");
    if (blocks.length > 0) {
      return NextResponse.json(
        { error: "config blocked by safety rules", findings: blocks },
        { status: 422 },
      );
    }
    const warns = lintResult.findings.filter((f) => f.tier === "warn");

    // ---- storage ------------------------------------------------------------
    const env = await getEnv();
    const db = await getDb();
    const now = Date.now();
    const versionId = ulid();

    let configId = meta.configId ?? null;
    let existing = null;
    if (configId) {
      existing = await db.select().from(configs).where(eq(configs.id, configId)).get();
      if (!existing || existing.ownerId !== user.id) {
        return NextResponse.json({ error: "config not found or not yours" }, { status: 403 });
      }
    } else {
      configId = ulid();
    }

    const withEntries = await Promise.all(
      expanded.map(async (f) => ({
        file: f,
        installPath: defaultInstallPath(f.name),
        sha256: await sha256Hex(f.bytes),
      })),
    );

    const fileKeyPrefix = `files/${configId}/${versionId}`;
    await Promise.all(
      withEntries.map(({ file, sha256 }) =>
        env.R2_FILES.put(`${fileKeyPrefix}/${sha256}`, file.bytes as unknown as ArrayBuffer),
      ),
    );
    const bundle = buildBundleZip(
      withEntries.map(({ file, installPath }) => ({ installPath, bytes: file.bytes })),
    );
    const zipR2Key = `${fileKeyPrefix}/bundle.zip`;
    await env.R2_FILES.put(zipR2Key, bundle as unknown as ArrayBuffer);

    // ---- db rows ------------------------------------------------------------
    const metadataJson = JSON.stringify({
      classesTouched: lintResult.classesTouched,
      moduleLevels: lintResult.moduleLevels,
      binds: Object.fromEntries(lintResult.binds),
      summary: lintResult.summary,
    });
    const preview = matchPreview({
      moduleLevels: lintResult.moduleLevels,
      effective: Object.fromEntries(
        [...lintResult.effective].map(([cvar, v]) => [cvar, v.value]),
      ),
    });
    const lintStatus = warns.length > 0 ? "warnings" : "clean";
    const status = shouldWithhold(warns.length, new Set(warns.map((w) => w.ruleId)))
      ? "withheld"
      : "published";

    const totalSize = expanded.reduce((sum, f) => sum + f.bytes.length, 0);

    const statements = [];
    if (existing) {
      statements.push(
        db
          .update(configs)
          .set({
            latestVersionId: versionId,
            updatedAt: now,
            status,
            previewTier: preview?.tier ?? null,
          })
          .where(eq(configs.id, configId)),
      );
    } else {
      const baseSlug = slugify(meta.name);
      const taken = await db.select({ slug: configs.slug }).from(configs).all();
      const takenSet = new Set(taken.map((r) => r.slug));
      let slug = baseSlug;
      for (let i = 2; takenSet.has(slug); i++) slug = `${baseSlug}-${i}`;

      statements.push(
        db.insert(configs).values({
          id: configId,
          slug,
          ownerId: user.id,
          name: meta.name,
          summary: meta.summary,
          descriptionMd: meta.description,
          category: meta.category,
          status,
          latestVersionId: versionId,
          previewTier: preview?.tier ?? null,
          createdAt: now,
          updatedAt: now,
        }),
      );
      if (lintResult.classesTouched.length > 0) {
        statements.push(
          db.insert(configClasses).values(
            lintResult.classesTouched.map((cls) => ({ configId: configId as string, class: cls })),
          ),
        );
      }
    }
    statements.push(
      db.insert(configVersions).values({
        id: versionId,
        configId,
        versionLabel: meta.versionLabel,
        changelogMd: meta.changelog,
        lintReportJson: JSON.stringify(lintResult.findings),
        lintStatus,
        metadataJson,
        previewKeyJson: preview ? JSON.stringify(preview) : null,
        zipR2Key,
        totalSizeBytes: totalSize,
        fileCount: expanded.length,
        createdAt: now,
      }),
      db.insert(files).values(
        withEntries.map(({ file, installPath, sha256 }) => ({
          id: ulid(),
          versionId,
          installPath,
          r2Key: `${fileKeyPrefix}/${sha256}`,
          sizeBytes: file.bytes.length,
          sha256,
          kind: file.name.toLowerCase().endsWith(".cfg")
            ? ("cfg" as const)
            : file.name.toLowerCase().endsWith(".txt")
              ? ("txt" as const)
              : ("other" as const),
        })),
      ),
    );
    // D1 batch = atomic
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);

    const slugRow = await db
      .select({ slug: configs.slug })
      .from(configs)
      .where(eq(configs.id, configId))
      .get();

    return NextResponse.json({
      configId,
      versionId,
      slug: slugRow?.slug,
      status,
      lintStatus,
      warnings: warns,
    });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("upload failed", err);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}
