// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStartupTidy } from "../hooks/useStartupTidy";
import type { Api } from "../lib/api";
import type { TidyReport } from "../lib/bridge";
import { tidyDetails, tidySummary } from "../lib/tidy-up-ui";
import { TidyUpNotice } from "./TidyUpNotice";

const empty: TidyReport = {
  soundCachesRemoved: [],
  hudBackupsDeleted: [],
  hudBackupsMoved: [],
  hudBackupsKept: 0,
  valveCfgsDropped: [],
  valveCfgsMissing: 0,
  managedFilesUpgraded: [],
  downloadsRemoved: [],
  freedBytes: 0,
  movedBytes: 0,
  skipped: [],
};

const owner: TidyReport = {
  ...empty,
  soundCachesRemoved: Array.from({ length: 30 }, (_, index) => `p${index}.vpk.sound.cache`),
  hudBackupsMoved: ["a", "b", "c", "d", "e", "f", "g"],
  movedBytes: 285 * 1024 * 1024,
  freedBytes: 2 * 1024 * 1024,
};

let root: Root;
let box: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

it("says what the tidy-up did in one short sentence", () => {
  expect(tidySummary(owner)).toBe(
    "execs tidied up after the update: removed 30 unused sound caches and moved 7 HUD backups (285.0 MB) out of TF2's folder, freeing 2.0 MB.",
  );
  expect(
    tidySummary({
      ...owner,
      downloadsRemoved: ["mods-v1.7.1.zip"],
      managedFilesUpgraded: [{ profile: "Low", kind: "preloadHook" }],
    }),
  ).toContain("and 2 other changes");
  expect(tidySummary(empty)).toBe("execs checked for leftovers from earlier versions.");
});

it("groups the details and names each profile's upgraded file", () => {
  const sections = tidyDetails({
    ...empty,
    managedFilesUpgraded: [{ profile: "Low", kind: "preloadHook" }],
    valveCfgsDropped: [{ profile: "Default", count: 23 }],
  });
  expect(sections.map((section) => section.items)).toEqual([
    ["Default: 23 files"],
    ["Low: Casual preload hook updated"],
  ]);
});

it("offers Steam's verify only when Valve's cfgs are missing", async () => {
  const onVerify = vi.fn();
  const onDismiss = vi.fn();
  const render = (report: TidyReport) =>
    act(async () =>
      root.render(
        <TidyUpNotice report={report} running={false} onVerify={onVerify} onDismiss={onDismiss} />,
      ),
    );
  const button = (label: string) =>
    [...document.body.querySelectorAll("button")].find((node) => node.textContent === label);
  await render(owner);
  await act(async () => button("Details")?.click());
  expect(document.body.textContent).toContain("and 22 more");
  expect(button("Verify TF2 in Steam")).toBeUndefined();
  await act(async () => button("Done")?.click());
  await render({ ...owner, valveCfgsMissing: 23 });
  await act(async () => button("Details")?.click());
  await act(async () => button("Verify TF2 in Steam")?.click());
  expect(onVerify).toHaveBeenCalledOnce();
  await act(async () => button("Dismiss")?.click());
  expect(onDismiss).toHaveBeenCalledOnce();
});

it("asks for the startup tidy-up once, when the library is ready and nothing runs", async () => {
  const run = vi.fn(async () => owner);
  const api = { runAutomaticTidyUp: run } as unknown as Api;
  const changed = vi.fn();
  const seen: { state: ReturnType<typeof useStartupTidy> | null } = { state: null };
  function Harness({ ready, running }: { ready: boolean; running: boolean }) {
    seen.state = useStartupTidy(api, { ready, running, busy: false }, changed);
    return null;
  }
  await act(async () => root.render(<Harness ready={false} running={false} />));
  await act(async () => root.render(<Harness ready running />));
  expect(run).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness ready running={false} />));
  await act(async () => root.render(<Harness ready running />));
  await act(async () => root.render(<Harness ready running={false} />));
  expect(run).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledOnce();
  expect(seen.state?.report).toEqual(owner);
});
