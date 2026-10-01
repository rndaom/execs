import type { SettingsTab } from "./settings-ui";

const GUIDE_BASE = "https://github.com/rndaom/execs/blob";

/**
 * The guide page for a pane, at the release this build came from so the
 * instructions match it. Development builds have no tag yet and use main.
 */
export function guideUrl(
  page: SettingsTab | "app-settings",
  version: string,
  development: boolean,
): string {
  const ref = development || !version ? "main" : encodeURIComponent(`v${version}`);
  return `${GUIDE_BASE}/${ref}/docs/guide/${page}.md`;
}
