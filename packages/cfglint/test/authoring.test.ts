import { describe, expect, it } from "vitest";
import { lint } from "../src/engine.ts";
import { sourceOffset, sourcePosition, tokenizeCommands } from "../src/tokenizer.ts";

const run = (text: string, trust: "self" | "provided" = "self") =>
  lint([{ path: "autoexec.cfg", text }], { trust });

describe("source-bound authoring diagnostics", () => {
  it("keeps original UTF-16 ranges through Unicode, CRLF, tabs and nested payloads", () => {
    const text = 'echo "😀";\r\n\tbind f "echo hello; fov_desired banana; +forwad"';
    const result = run(text);
    const number = result.findings.find((finding) => finding.ruleId === "argument-number");
    const unknown = result.findings.find((finding) => finding.ruleId === "unknown-command");
    expect(number).toMatchObject({
      from: text.indexOf("banana"),
      to: text.indexOf("banana") + 6,
      line: 2,
      category: "argument",
      via: "bind f",
    });
    expect(unknown).toMatchObject({
      from: text.indexOf("+forwad"),
      to: text.indexOf("+forwad") + 7,
    });
    expect(text.slice(number?.from, number?.to)).toBe("banana");
    for (let offset = 0; offset <= text.length; offset++) {
      const point = sourcePosition(text, offset);
      expect(sourceOffset(text, point.line, point.col)).toBe(offset);
    }
  });

  it("anchors alias findings in the definition, with an invocation trace", () => {
    const text = 'alias bad "fov_desired banana"\nbind f bad';
    const findings = run(text).findings.filter((finding) => finding.ruleId === "argument-number");
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(text.slice(finding.from, finding.to)).toBe("banana");
    expect(findings.some((finding) => finding.via === "bind f → alias bad")).toBe(true);
  });

  it("aligns quoted argument coordinates with the selected content", () => {
    const text = 'fov_desired "banana"';
    const finding = run(text).findings.find((entry) => entry.ruleId === "argument-number");
    expect(finding).toMatchObject({ from: 13, to: 19, line: 1, col: 14 });
  });

  it("reports coercion and bounds without changing the source or blocking Save", () => {
    const result = run("fov_desired banana; fov_desired 999; +forwad");
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["argument-number", "argument-range", "unknown-command"]),
    );
    expect(result.ok).toBe(true);
    expect(run("fov_desired").findings).toEqual([]);
    expect(run("voicemenu 0").findings.some((finding) => finding.ruleId === "argument-count")).toBe(
      true,
    );
    expect(run("voicemenu 0 0 ignored").findings).toEqual([]);
    expect(
      run("voicemenu 1e2 0").findings.some((finding) => finding.ruleId === "argument-number"),
    ).toBe(true);
  });

  it("keeps literal backslashes, quoted separators and quote-recovery spans", () => {
    const text = 'echo "a\\b;//x"\r\nbind f "unterminated\r\nvolume 1';
    const tokens = tokenizeCommands(text);
    expect(tokens[0][1].value).toBe("a\\b;//x");
    expect(tokens[1][2].value).toBe("unterminated");
    const result = run(text);
    const finding = result.findings.find((entry) => entry.ruleId === "syntax-quote");
    expect(text.slice(finding?.from, finding?.to)).toBe('"unterminated');
    expect(result.safetyComplete).toBe(false);
    expect(result.executionComplete).toBe(true);
    expect(result.binds.has("f")).toBe(false);
    expect(result.effective.get("volume")?.value).toBe("1");
  });

  it("keeps safety coverage distinct from startup completeness", () => {
    const result = run('alias dormant "exec missing"\nfov_desired 90');
    expect(result.safetyComplete).toBe(false);
    expect(result.executionComplete).toBe(true);
    expect(result.effective.get("fov_desired")?.value).toBe("90");
    expect(run('alias loop "loop"').safetyComplete).toBe(false);
    expect(run("exec config_default").safetyComplete).toBe(false);
  });
});

describe("personal authoring and imported policy remain separate", () => {
  it("allows exact personal menu restoration but refuses compound and alias lockout", () => {
    expect(run("bind escape cancelselect").ok).toBe(true);
    expect(run("bind escape").ok).toBe(true);
    expect(run('bind escape "escape"').ok).toBe(true);
    expect(run("bind escape cancelselect", "provided").ok).toBe(false);
    for (const text of [
      'bind escape "cancelselect; quit"',
      'alias menu "cancelselect"\nbind escape menu',
      "unbind escape",
      "con_enable 0",
    ])
      expect(run(text).ok).toBe(false);
  });

  it("does not warn about routine personal mouse or chat choices", () => {
    const text = 'sensitivity 2\nbind f "say hello"';
    expect(run(text).findings).toEqual([]);
    expect(run(text, "provided").findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["mouse-tamper", "chat-bind"]),
    );
    expect(run("connect server").findings[0].message).toContain("when this command runs");
  });

  it("explains the explicit engine serialization destination", () => {
    expect(run("host_writeconfig backup").findings[0].message).toContain("backup.cfg");
    expect(run("host_writeconfig").findings[0].message).toContain("config.cfg");
  });

  it("never echoes credentials and keeps save/export restrictions", () => {
    for (const trust of ["self", "provided"] as const) {
      const result = run('password "private-value"', trust);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result.findings)).not.toContain("private-value");
      expect(result.findings[0].category).toBe("restriction");
    }
  });
});
