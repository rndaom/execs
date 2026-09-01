export { lookupCvar } from "./corpus.ts";
export { lint } from "./engine.ts";
export {
  type CfgOrigin,
  cfgPathIsAdvisory,
  cfgPathIsEditable,
  classifyCfgOrigin,
  ENGINE_MANAGED_CONFIG_PATH,
  engineManagedLintOptions,
  normalizeCfgPath,
} from "./lint-options.ts";
export { parseCommands } from "./parser.ts";
export { tokenizeCommands } from "./tokenizer.ts";
export type {
  CfgFile,
  Command,
  CvarValue,
  Finding,
  FindingTier,
  LintOptions,
  LintResult,
  LintTrust,
  SummaryEntry,
  SummarySection,
  TfClass,
  Token,
} from "./types.ts";
