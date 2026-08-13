import { describe, expect, it } from "vitest";
import { tokenizeCommands } from "../src/tokenizer.ts";

const flat = (text: string) => tokenizeCommands(text).map((cmd) => cmd.map((t) => t.value));

describe("tokenizeCommands", () => {
  it("splits commands on newlines and semicolons", () => {
    expect(flat("fov_desired 90\ncl_interp 0.033;cl_interp_ratio 1")).toEqual([
      ["fov_desired", "90"],
      ["cl_interp", "0.033"],
      ["cl_interp_ratio", "1"],
    ]);
  });

  it("strips // comments", () => {
    expect(flat("volume 0.5 // set volume\n// full line comment\nsensitivity 2")).toEqual([
      ["volume", "0.5"],
      ["sensitivity", "2"],
    ]);
  });

  it("keeps semicolons inside quoted payloads as one token", () => {
    expect(flat('bind mouse1 "+attack; say hi"')).toEqual([["bind", "mouse1", "+attack; say hi"]]);
  });

  it("does not treat // inside quotes as a comment", () => {
    expect(flat('echo "https://example.com"')).toEqual([["echo", "https://example.com"]]);
  });

  it("terminates an unclosed quote at end of line (engine behavior)", () => {
    expect(flat('bind q "kill\nvolume 1')).toEqual([
      ["bind", "q", "kill"],
      ["volume", "1"],
    ]);
  });

  it("handles CRLF input identically to LF", () => {
    expect(flat("volume 0.5\r\nsensitivity 2\r\n")).toEqual(flat("volume 0.5\nsensitivity 2\n"));
  });

  it("records accurate line and column spans", () => {
    const [[first], [second]] = tokenizeCommands("volume 0.5\n  sensitivity 2");
    expect({ line: first.line, col: first.col }).toEqual({ line: 1, col: 1 });
    expect({ line: second.line, col: second.col }).toEqual({ line: 2, col: 3 });
  });

  it("produces empty output for comment-only input", () => {
    expect(flat("// nothing here\n\n  \n")).toEqual([]);
  });
});
