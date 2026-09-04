import { describe, expect, it } from "vitest";
import {
  addEditorTextToBudget,
  editorCfgCandidates,
  editorPathFits,
  editorTextBytes,
  FILES_EDITOR_MAX_FILE_BYTES,
  FILES_EDITOR_MAX_FILES,
  FILES_EDITOR_MAX_TOTAL_BYTES,
  utf8ByteLengthAtMost,
} from "./files-limits";

describe("Files editor input limits", () => {
  it("counts UTF-8 bytes without accepting multibyte strings by code-unit length", () => {
    expect(utf8ByteLengthAtMost("aé😀", 7)).toBe(7);
    expect(utf8ByteLengthAtMost("aé😀", 6)).toBeNull();
    expect(editorTextBytes("x".repeat(FILES_EDITOR_MAX_FILE_BYTES))).toBe(
      FILES_EDITOR_MAX_FILE_BYTES,
    );
    expect(editorTextBytes("é".repeat(FILES_EDITOR_MAX_FILE_BYTES / 2 + 1))).toBeNull();
  });

  it("caps the retained bundle by aggregate bytes", () => {
    const oneMiB = "x".repeat(FILES_EDITOR_MAX_FILE_BYTES);
    let total = 0;
    for (let index = 0; index < FILES_EDITOR_MAX_TOTAL_BYTES / oneMiB.length; index += 1) {
      total = addEditorTextToBudget(total, oneMiB) ?? -1;
    }
    expect(total).toBe(FILES_EDITOR_MAX_TOTAL_BYTES);
    expect(addEditorTextToBudget(total, "x")).toBeNull();
  });

  it("sends no more than the cfg count cap to IPC", () => {
    const source = [
      ...Array.from({ length: FILES_EDITOR_MAX_FILES + 1 }, (_, index) => ({
        path: `tf/custom/hud/cfg/${index}.cfg`,
      })),
      { path: "tf/cfg/overrides/execs_binds.cfg" },
    ];
    const result = editorCfgCandidates(source);
    expect(result.files).toHaveLength(FILES_EDITOR_MAX_FILES);
    expect(result.files[0]?.path).toBe("tf/cfg/overrides/execs_binds.cfg");
    expect(result.limited).toBe(true);
  });

  it("drops overlong UTF-8 paths before an IPC call", () => {
    expect(editorPathFits("tf/cfg/autoexec.cfg")).toBe(true);
    expect(editorPathFits(`tf/cfg/${"é".repeat(509)}.cfg`)).toBe(false);
    const result = editorCfgCandidates([
      { path: `tf/cfg/${"é".repeat(509)}.cfg` },
      { path: "tf/cfg/autoexec.cfg" },
    ]);
    expect(result).toEqual({ files: [{ path: "tf/cfg/autoexec.cfg" }], limited: true });
  });
});
