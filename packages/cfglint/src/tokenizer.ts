import type { Token } from "./types.ts";

/**
 * Tokenizes Source-engine cfg text into commands (token lists).
 *
 * Semantics: `//` comments to end of line; `"` quotes a single token (the
 * Source console has no escape sequences inside quotes — a quote always ends
 * the token); `;` and newlines separate commands; other whitespace separates
 * tokens. Unterminated quotes recover at the next line for bounded analysis;
 * this recovery is not a claim about every retail engine build.
 */
export function tokenizeCommands(text: string): Token[][] {
  const commands: Token[][] = [];
  let current: Token[] = [];
  let line = 1;
  let col = 1;
  let i = 0;

  const endCommand = () => {
    if (current.length > 0) {
      commands.push(current);
      current = [];
    }
  };

  const n = text.length;
  while (i < n) {
    const ch = text[i];

    if (ch === "\n") {
      endCommand();
      line++;
      col = 1;
      i++;
      continue;
    }
    // UTF-8 cfgs can begin with a decoded BOM. Source treats that marker as
    // encoding metadata, not as part of the first console command.
    if (ch === "\r" || ch === " " || ch === "\t" || ch === "\uFEFF") {
      i++;
      col++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") {
        i++;
        col++;
      }
      continue;
    }
    if (ch === ";") {
      endCommand();
      i++;
      col++;
      continue;
    }
    if (ch === '"') {
      const startLine = line;
      const startCol = col;
      const from = i;
      i++;
      col++;
      let value = "";
      while (i < n && text[i] !== '"' && text[i] !== "\n" && text[i] !== "\r") {
        value += text[i];
        i++;
        col++;
      }
      const contentTo = i;
      const closed = text[i] === '"';
      if (closed) {
        i++;
        col++;
      }
      current.push({
        value,
        line: startLine,
        col: startCol,
        quoted: true,
        from,
        to: i,
        contentFrom: from + 1,
        contentTo,
        closed,
      });
      continue;
    }

    const startLine = line;
    const startCol = col;
    const from = i;
    let value = "";
    while (i < n && !' \t\r\n";'.includes(text[i]) && !(text[i] === "/" && text[i + 1] === "/")) {
      value += text[i];
      i++;
      col++;
    }
    current.push({
      value,
      line: startLine,
      col: startCol,
      quoted: false,
      from,
      to: i,
      contentFrom: from,
      contentTo: i,
      closed: true,
    });
  }
  endCommand();
  return commands;
}

/** One-based UTF-16 line/column; tabs occupy one source column, not display width. */
export function sourcePosition(text: string, offset: number): { line: number; col: number } {
  const end = Math.max(0, Math.min(text.length, offset));
  let line = 1;
  let start = 0;
  for (let i = 0; i < end; i++) {
    if (text[i] === "\n") {
      line++;
      start = i + 1;
    }
  }
  return { line, col: end - start + 1 };
}

/** Clamp an editor line/column to the unchanged source. */
export function sourceOffset(text: string, line: number, col: number): number {
  let start = 0;
  for (let current = 1; current < line; current++) {
    const next = text.indexOf("\n", start);
    if (next < 0) return text.length;
    start = next + 1;
  }
  const end = text.indexOf("\n", start);
  return Math.min(end < 0 ? text.length : end, start + Math.max(0, col - 1));
}
