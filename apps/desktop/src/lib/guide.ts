import type { SettingsTab } from "./settings-ui";

const GUIDE_BASE = "https://github.com/rndaom/execs/blob";

/** A pane's page, or the page for App settings or for the Setups home. */
export type GuidePage = SettingsTab | "app-settings" | "profiles";

/**
 * The guide page for a pane, at the release this build came from so the
 * instructions match it. Development builds have no tag yet and use main.
 */
export function guideUrl(page: GuidePage, version: string, development: boolean): string {
  const ref = development || !version ? "main" : encodeURIComponent(`v${version}`);
  return `${GUIDE_BASE}/${ref}/docs/guide/${page}.md`;
}
