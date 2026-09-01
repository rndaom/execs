import * as realBridge from "./bridge";
import { isTauri } from "./bridge";
import type { PreviewState } from "./preview";

/**
 * The command surface every screen talks to.
 *
 * Derived from `bridge.ts` itself, so a new command is automatically required
 * of the preview adapter too — preview mode can no longer fall behind the real
 * app one forgotten `if (!tauri)` branch at a time.
 */
export type Api = Omit<
  typeof realBridge,
  | "isTauri"
  | "BridgeError"
  | "UNKNOWN_ERROR_CODE"
  | "parseInvokeError"
  | "invokeErrorMessage"
  | "default"
>;

export const bridgeApi: Api = realBridge;

/**
 * Pick the adapter once, at the root. The preview fixtures live behind a
 * `import.meta.env.DEV` dynamic import so Rollup drops them (and every
 * `PREVIEW_*` constant they reach) from the packaged bundle.
 */
export async function resolveApi(preview: PreviewState): Promise<Api> {
  if (isTauri() || !import.meta.env.DEV) {
    return bridgeApi;
  }
  const { createPreviewApi } = await import("./preview-bridge");
  return createPreviewApi(preview);
}
