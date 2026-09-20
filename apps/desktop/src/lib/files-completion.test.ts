import { describe, expect, it } from "vitest";
import { type CompletionCatalog, cfgCompletionContext, cfgCompletions } from "./files-completion";

const catalog: CompletionCatalog = {
  commands: [
    { label: "+attack", type: "function" },
    { label: "cl_interp", type: "variable" },
  ],
  keys: [{ label: "mouse1", type: "constant" }],
  arguments: { test_enum: [{ label: "verified", type: "constant" }] },
};
describe("Source completion context", () => {
  it("tracks semicolons, quoted payloads, plus/minus aliases and exact replacement ranges", () => {
    const text = 'bind mouse1 "echo hi; +attZZ"';
    const pos = text.indexOf("ZZ");
    expect(cfgCompletionContext(text, pos)).toEqual({
      from: text.indexOf("+att"),
      to: pos + 2,
      command: "",
      argument: 0,
    });
    const files = [
      { path: "cfg/autoexec.cfg", text: 'alias +rocket "+attack"\nalias -rocket "-attack"' },
    ];
    expect(cfgCompletions("-roc", 4, files, catalog)?.options.map((x) => x.label)).toContain(
      "-rocket",
    );
  });
  it("does not suggest in comments including command payload comments", () => {
    expect(cfgCompletionContext("echo hi // cl_", 14)).toBeNull();
    const payload = 'alias foo "echo hi; // cl_';
    expect(cfgCompletionContext(payload, payload.length)).toBeNull();
  });
  it("uses appropriate keys and cfg-relative paths without guessing arbitrary arguments", () => {
    expect(cfgCompletions("bind m", 6, [], catalog)?.options).toEqual(catalog.keys);
    const files = [
      { path: "cfg/overrides/execs_binds.cfg", text: "" },
      { path: "custom/hud/test.cfg", text: "" },
    ];
    expect(cfgCompletions('exec "over', 10, files, catalog)?.options.map((x) => x.label)).toEqual([
      "overrides/execs_binds",
    ]);
    expect(cfgCompletions("cl_interp ", 10, files, catalog)?.options).toEqual([]);
    expect(cfgCompletions("test_enum ", 10, files, catalog)?.options).toEqual(
      catalog.arguments.test_enum,
    );
  });
  it("treats backslashes literally and isolates each command and line", () => {
    const text = 'echo "x\\"; bind ';
    expect(cfgCompletionContext(text, text.length)?.command).toBe("bind");
    expect(cfgCompletionContext("echo x\ncl_", 10)?.argument).toBe(0);
  });
});
