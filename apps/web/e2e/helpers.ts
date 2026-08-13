import type { Page } from "@playwright/test";

/**
 * Replaces window.showDirectoryPicker with a stub returning the page's OPFS
 * root, pre-seeded with a fake TF2 layout (tf/gameinfo.txt + hl2/). Runs in
 * the MAIN world before any page script, exactly like a user granting access
 * to a real TF2 folder — everything downstream (handle persistence, writes,
 * manifest) exercises real Chromium FileSystem handles.
 */
export async function stubTf2Picker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker =
      async () => {
        const root = await navigator.storage.getDirectory();
        const tf = await root.getDirectoryHandle("tf", { create: true });
        const gi = await tf.getFileHandle("gameinfo.txt", { create: true });
        const w = await gi.createWritable();
        await w.write('"GameInfo" {}');
        await w.close();
        await root.getDirectoryHandle("hl2", { create: true });
        return root;
      };
  });
}

/** Reads a file from the page's OPFS; returns null when missing. */
export async function readOpfsFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (p) => {
    try {
      let dir = await navigator.storage.getDirectory();
      const parts = p.split("/");
      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part);
      }
      const fh = await dir.getFileHandle(parts[parts.length - 1]);
      return await (await fh.getFile()).text();
    } catch {
      return null;
    }
  }, path);
}
