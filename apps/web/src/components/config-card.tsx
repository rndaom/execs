import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Config } from "@/db/schema";

const CATEGORY_LABELS: Record<string, string> = {
  "full-setup": "Full setup",
  "class-config": "Class config",
  graphics: "Graphics",
  network: "Network",
  binds: "Binds",
  scripts: "Scripts",
};

// Item-quality palette applied to categories — instantly legible to TF2 players.
const CATEGORY_STYLE: Record<string, string> = {
  "full-setup": "border-q-unique text-q-unique",
  "class-config": "border-q-genuine text-q-genuine",
  graphics: "border-q-strange text-q-strange",
  network: "border-q-vintage text-q-vintage",
  binds: "border-q-unusual text-q-unusual",
  scripts: "border-team-blu text-team-blu",
};

export function ConfigCard({ config, ownerName }: { config: Config; ownerName: string }) {
  return (
    <Link
      href={`/configs/${config.slug}`}
      className="group flex flex-col gap-2 rounded-lg border border-edge bg-panel p-4 transition-colors hover:border-brand"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-lg leading-tight group-hover:text-brand">{config.name}</h3>
        <Badge variant="outline" className={CATEGORY_STYLE[config.category] ?? ""}>
          {CATEGORY_LABELS[config.category] ?? config.category}
        </Badge>
      </div>
      <p className="line-clamp-2 text-sm text-ink-muted">{config.summary}</p>
      <div className="mt-auto flex items-center justify-between pt-2 text-xs text-ink-faint">
        <span>by {ownerName}</span>
        <span>
          {config.downloadCount} download{config.downloadCount === 1 ? "" : "s"}
        </span>
      </div>
    </Link>
  );
}
