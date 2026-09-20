import corpus, { sources } from "./cvars.gen.ts";

export interface CatalogArgument {
  name: string;
  type?: "integer" | "number" | "string";
  optional?: boolean;
  rest?: boolean;
  values?: readonly string[];
  min?: number;
  max?: number;
}

export interface CatalogSource {
  url: string;
  revision: string;
  /** Date this pinned source was reviewed, not a claim about the current game. */
  date: string;
  description: string;
}

export interface CatalogEntry {
  name: string;
  kind: "command" | "cvar" | "alias";
  help?: string;
  defaultValue?: string;
  flags: readonly string[];
  syntax?: string;
  arguments?: readonly CatalogArgument[];
  value?: CatalogArgument;
  applicability: string;
  sources: readonly CatalogSource[];
}

const entries: readonly CatalogEntry[] = Object.freeze(
  Object.entries(corpus).map(([name, entry]) =>
    Object.freeze({
      name,
      kind: entry.k ?? (entry.c ? "command" : "cvar"),
      help: entry.h,
      defaultValue: entry.d,
      flags: Object.freeze([...(entry.f ?? [])]),
      syntax: entry.syntax,
      value: entry.value ? Object.freeze({ ...entry.value }) : undefined,
      arguments: entry.arguments
        ? Object.freeze(entry.arguments.map((argument) => Object.freeze({ ...argument })))
        : undefined,
      applicability: entry.a,
      sources: Object.freeze(entry.s.map((index) => Object.freeze({ ...sources[index] }))),
    }),
  ),
);
const byName = new Map(entries.map((entry) => [entry.name, entry]));

/** Offline pinned evidence, not an enumeration of commands available in a running game. */
export function enumerateCatalog(): readonly CatalogEntry[] {
  return entries;
}

export function lookupCommand(name: string): CatalogEntry | undefined {
  return byName.get(name.toLowerCase());
}
