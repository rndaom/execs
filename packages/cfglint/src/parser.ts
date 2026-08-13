import { tokenizeCommands } from "./tokenizer.ts";
import type { Command } from "./types.ts";

export function parseCommands(text: string, file: string): Command[] {
  return tokenizeCommands(text)
    .filter((tokens) => tokens.length > 0 && tokens[0].value !== "")
    .map((tokens) => ({
      name: tokens[0].value.toLowerCase(),
      args: tokens.slice(1).map((t) => t.value),
      tokens,
      file,
      line: tokens[0].line,
      col: tokens[0].col,
    }));
}
