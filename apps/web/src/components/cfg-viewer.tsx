"use client";

import { tokenizeCommands } from "@execs/cfglint";
import { useMemo, useState } from "react";

interface ViewerFile {
  installPath: string;
  text: string;
}

/** Syntax-ish highlighting driven by the linter's own tokenizer — no extra dep. */
function HighlightedCfg({ text }: { text: string }) {
  const lines = useMemo(() => {
    const byLine = new Map<number, Array<{ value: string; col: number; first: boolean; quoted: boolean }>>();
    for (const cmd of tokenizeCommands(text)) {
      cmd.forEach((token, i) => {
        const arr = byLine.get(token.line) ?? [];
        arr.push({ value: token.value, col: token.col, first: i === 0, quoted: token.quoted });
        byLine.set(token.line, arr);
      });
    }
    return text.split(/\r?\n/).map((raw, idx) => ({ raw, tokens: byLine.get(idx + 1) ?? [] }));
  }, [text]);

  return (
    <pre className="overflow-x-auto p-3 text-xs leading-5">
      {lines.map((line, i) => {
        const commentStart = line.raw.indexOf("//");
        return (
          <div key={`line-${i + 1}`}>
            {line.tokens.length === 0 && commentStart === -1 && <span>{line.raw || " "}</span>}
            {line.tokens.length === 0 && commentStart !== -1 && (
              <span className="text-ink-faint italic">{line.raw}</span>
            )}
            {line.tokens.length > 0 &&
              renderTokens(line.raw, line.tokens, commentStart)}
          </div>
        );
      })}
    </pre>
  );
}

function renderTokens(
  raw: string,
  tokens: Array<{ value: string; col: number; first: boolean; quoted: boolean }>,
  commentStart: number,
) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const [i, token] of tokens.entries()) {
    const start = token.col - 1;
    if (start > pos) parts.push(<span key={`gap-${i}`}>{raw.slice(pos, start)}</span>);
    const width = token.quoted ? token.value.length + 2 : token.value.length;
    const cls = token.first
      ? "text-brand"
      : token.quoted
        ? "text-q-genuine"
        : "text-ink";
    parts.push(
      <span key={`tok-${i}`} className={cls}>
        {raw.slice(start, start + width)}
      </span>,
    );
    pos = start + width;
  }
  if (pos < raw.length) {
    const rest = raw.slice(pos);
    parts.push(
      <span key="rest" className={commentStart !== -1 ? "text-ink-faint italic" : ""}>
        {rest}
      </span>,
    );
  }
  return parts;
}

export function CfgViewer({ files }: { files: ViewerFile[] }) {
  const [active, setActive] = useState(0);
  if (files.length === 0) return null;
  return (
    <section className="flex flex-col rounded-lg border border-edge bg-panel">
      <div className="flex flex-wrap gap-1 border-b border-edge p-2">
        {files.map((f, i) => (
          <button
            key={f.installPath}
            type="button"
            onClick={() => setActive(i)}
            className={`rounded px-2 py-1 text-xs ${
              i === active ? "bg-panel-raised text-ink" : "text-ink-faint hover:text-ink-muted"
            }`}
          >
            {f.installPath.split("/").pop()}
          </button>
        ))}
      </div>
      <p className="border-b border-edge px-3 py-1.5 text-xs text-ink-faint">
        installs to <code>{files[active].installPath}</code>
      </p>
      <HighlightedCfg text={files[active].text} />
    </section>
  );
}
