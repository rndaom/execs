import type { Finding, SummarySection } from "@execs/cfglint";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CfgViewer } from "@/components/cfg-viewer";
import { InstallButton } from "@/components/install-button";
import { SafetyReport } from "@/components/safety-report";
import { WhatThisChanges } from "@/components/what-this-changes";
import { Badge } from "@/components/ui/badge";
import { getEnv } from "@/lib/cf";
import { getConfigPage } from "@/lib/queries";

export const dynamic = "force-dynamic";

interface VersionMetadata {
  classesTouched: string[];
  moduleLevels: Record<string, string>;
  binds: Record<string, string>;
  summary: SummarySection[];
}

export default async function ConfigPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ uploaded?: string }>;
}) {
  const { slug } = await params;
  const { uploaded } = await searchParams;
  const page = await getConfigPage(slug);
  if (!page || page.status === "removed") notFound();

  const latest = page.latest;
  const metadata: VersionMetadata | null = latest ? JSON.parse(latest.metadataJson) : null;
  const findings: Finding[] = latest ? JSON.parse(latest.lintReportJson) : [];

  // Pull cfg/txt contents from R2 for the file viewer (small files by upload cap).
  const env = await getEnv();
  const viewerFiles = (
    await Promise.all(
      page.files
        .filter((f) => f.kind !== "other")
        .map(async (f) => {
          const obj = await env.R2_FILES.get(f.r2Key);
          return obj ? { installPath: f.installPath, text: await obj.text() } : null;
        }),
    )
  ).filter((f): f is { installPath: string; text: string } => f !== null);

  return (
    <div className="flex flex-col gap-6">
      {uploaded === "withheld" && (
        <div className="rounded-lg border border-q-strange bg-panel p-4 text-sm">
          Your upload is <strong>under review</strong> — its safety warnings need a quick human
          look before it's public. Only you can see it right now.
        </div>
      )}
      {page.status === "withheld" && uploaded !== "withheld" && (
        <div className="rounded-lg border border-q-strange bg-panel p-4 text-sm">
          This config is under review and not publicly listed.
        </div>
      )}

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl">{page.name}</h1>
          <Badge variant="outline">{page.category.replace("-", " ")}</Badge>
          {latest?.lintStatus === "clean" ? (
            <Badge className="bg-health text-on-brand">lint clean</Badge>
          ) : (
            <Badge className="bg-q-strange text-on-brand">has warnings</Badge>
          )}
        </div>
        <p className="text-ink-muted">{page.summary}</p>
        <p className="text-sm text-ink-faint">
          by{" "}
          <Link href={`/u/${page.ownerSteamId}`} className="underline hover:text-ink-muted">
            {page.ownerName}
          </Link>{" "}
          · {page.downloadCount} downloads · {page.installCount} installs
          {metadata && metadata.classesTouched.length > 0 && (
            <> · classes: {metadata.classesTouched.join(", ")}</>
          )}
        </p>
      </header>

      {latest && (
        <div className="flex flex-wrap items-center gap-3">
          <InstallButton versionId={latest.id} versionLabel={latest.versionLabel} />
          <a
            href={`/api/download/${latest.id}`}
            className="rounded-pill border border-edge px-6 py-2 text-sm text-ink-muted hover:border-brand hover:text-brand"
          >
            Download zip
          </a>
          <span className="text-xs text-ink-faint">
            {(latest.totalSizeBytes / 1024).toFixed(1)} KB · {latest.fileCount} file
            {latest.fileCount === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {page.descriptionMd && (
        <section className="whitespace-pre-wrap rounded-lg border border-edge bg-panel p-4 text-sm">
          {page.descriptionMd}
        </section>
      )}

      {page.media.length > 0 && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {page.media.map((m) =>
            m.type === "image" && m.r2Key ? (
              // biome-ignore lint/performance/noImgElement: R2-served, no optimizer on Workers
              <img
                key={m.id}
                src={`/media/${m.r2Key}`}
                alt=""
                className="rounded-lg border border-edge"
                loading="lazy"
              />
            ) : m.type === "youtube" && m.youtubeId ? (
              <iframe
                key={m.id}
                src={`https://www.youtube-nocookie.com/embed/${m.youtubeId}`}
                title="Config video"
                className="aspect-video w-full rounded-lg border border-edge"
                allowFullScreen
              />
            ) : null,
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SafetyReport findings={findings} />
        {metadata && (
          <WhatThisChanges summary={metadata.summary} moduleLevels={metadata.moduleLevels} />
        )}
      </div>

      <CfgViewer files={viewerFiles} />

      {page.versions.length > 1 && (
        <section className="rounded-lg border border-edge bg-panel p-4">
          <h2 className="mb-2 font-display text-xl">Versions</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {page.versions.map((v) => (
              <li key={v.id} className="flex items-baseline justify-between border-b border-edge pb-1">
                <span>
                  v{v.versionLabel}
                  {v.id === page.latestVersionId && (
                    <span className="ml-2 text-xs text-brand">latest</span>
                  )}
                  {v.changelogMd && <span className="ml-2 text-ink-muted">{v.changelogMd}</span>}
                </span>
                <a href={`/api/download/${v.id}`} className="text-xs underline text-ink-faint">
                  download
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
