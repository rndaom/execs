import type { Token } from "./types.ts";

/**
 * Tokenizes Source-engine cfg text into commands (token lists).
 *
 * Semantics: `//` comments to end of line; `"` quotes a single token (the
 * Source console has no escape sequences inside quotes — a quote always ends
 * the token); `;` and newlines separate commands; other whitespace separates
 * tokens. An unterminated quote runs to end of line, matching engine behavior.
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
    if (ch === "\r" || ch === " " || ch === "\t") {
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
      i++;
      col++;
      let value = "";
      while (i < n && text[i] !== '"' && text[i] !== "\n") {
        value += text[i];
        i++;
        col++;
      }
      if (text[i] === '"') {
        i++;
        col++;
      }
      current.push({ value, line: startLine, col: startCol, quoted: true });
      continue;
    }

    const startLine = line;
    const startCol = col;
    let value = "";
    while (i < n && !' \t\r\n";'.includes(text[i]) && !(text[i] === "/" && text[i + 1] === "/")) {
      value += text[i];
      i++;
      col++;
    }
    current.push({ value, line: startLine, col: startCol, quoted: false });
  }
  endCommand();
  return commands;
}
