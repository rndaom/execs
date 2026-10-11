import {
  ArrowLeft,
  CaretRight,
  GameController,
  Gauge,
  Monitor,
  Package,
  SpeakerHigh,
  Wrench,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { TabIcon } from "./components/ui/tabIcons";
import type { Api } from "./lib/api";
import type { HudCatalogEntry } from "./lib/bridge";
import type { SettingsTab, SetupGroupId } from "./lib/settings-ui";
import { type SheetInput, sheetGroups } from "./lib/setup-sheet";
import { hudLabel, hudPicture } from "./lib/setups-ui";
import { Picture } from "./SetupsHome";

const GROUP_ICONS: Record<SetupGroupId, TabIcon> = {
  look: Monitor,
  feel: GameController,
  sound: SpeakerHigh,
  mods: Package,
  performance: Gauge,
  advanced: Wrench,
};

/**
 * The Edit page: every setting of the setup in the game on one page, grouped
 * like the sidebar. It only reads; each row opens the pane that changes it.
 */
export function SetupSheet({
  api,
  input,
  refreshKey,
  changed,
  onOpen,
  onBack,
}: {
  api: Pick<Api, "getCachedHudCatalog" | "getSetupOverviews">;
  input: Omit<SheetInput, "catalog" | "casualChoices">;
  /** Changes whenever the profile is read again. */
  refreshKey: string;
  /** Panes with changes that have not reached the profile yet. */
  changed?: ReadonlySet<SettingsTab>;
  onOpen: (tab: SettingsTab) => void;
  onBack: () => void;
}) {
  const { detail } = input;
  const [catalog, setCatalog] = useState<HudCatalogEntry[]>([]);
  const [casual, setCasual] = useState<{ id: string; count: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Names and pictures are a nicety: without the saved catalog the HUD id shows.
    api
      .getCachedHudCatalog()
      .then((result) => {
        if (!cancelled) setCatalog(result?.entries ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  const profileId = detail.id;
  const mods = detail.mods?.length ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-reads the counts after a save or switch.
  useEffect(() => {
    let cancelled = false;
    // The overview counts Casual setup choices along with the profile's mods.
    api
      .getSetupOverviews()
      .then((overviews) => {
        const overview = overviews.find((item) => item.id === profileId);
        if (!cancelled && overview) {
          setCasual({ id: profileId, count: Math.max(0, overview.mods - mods) });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, profileId, mods, refreshKey]);

  const groups = sheetGroups({
    ...input,
    catalog,
    casualChoices: casual?.id === profileId ? casual.count : 0,
  });
  const picture = hudPicture(detail.hud?.id ?? null, catalog);

  return (
    <section data-testid="setup-sheet" className="setup-sheet min-w-0 text-left">
      <button type="button" className="btn btn-ghost setup-sheet-back" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" />
        Setups
      </button>
      <div className="setup-sheet-head">
        <Picture src={picture} alt="" className="setups-shot setup-sheet-shot">
          <span className="setups-shot-label">
            {detail.hud ? hudLabel(detail.hud.id, catalog) : "TF2's own HUD"}
          </span>
        </Picture>
        <div className="min-w-0">
          <h1 className="setups-name setup-sheet-name" tabIndex={-1} data-pane-heading>
            {detail.name}
          </h1>
          <p className="setups-sub">
            <span className="setups-dot setups-dot-ok" aria-hidden="true" />
            In the game now
          </p>
        </div>
      </div>
      {groups.map((group) => {
        const Icon = GROUP_ICONS[group.id];
        return (
          <section
            key={group.id}
            data-testid={`setup-sheet-${group.id}`}
            className="setup-group"
            aria-labelledby={`setup-group-${group.id}`}
          >
            <h2 id={`setup-group-${group.id}`} className="setup-group-title">
              <Icon size={16} aria-hidden="true" />
              {group.label}
            </h2>
            <div className="setup-rows">
              {group.rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  data-testid={`setup-row-${row.key}`}
                  className="setup-row"
                  onClick={() => onOpen(row.tab)}
                >
                  <span className="setup-row-label">{row.label}</span>
                  <span className="setup-row-value">
                    <span className="setup-row-text">
                      {row.value}
                      {row.more ? <span className="setup-row-more"> · {row.more}</span> : null}
                    </span>
                    {changed?.has(row.tab) ? (
                      <span className="settings-nav-change setup-row-change">
                        <span className="sr-only">, has unsaved changes</span>
                      </span>
                    ) : null}
                  </span>
                  <CaretRight size={16} aria-hidden="true" className="setup-row-caret" />
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}
