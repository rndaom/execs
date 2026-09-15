export const ALIAS_FANOUT_WIDTH = 6;
export const ALIAS_FANOUT_LEVELS = 7;

// Exponential breadth without the expansion cap; shared with the audit benchmark.
export const ALIAS_FANOUT = [
  ...Array.from(
    { length: ALIAS_FANOUT_LEVELS - 1 },
    (_, i) => `alias a${i + 1} "${`a${i + 2}; `.repeat(ALIAS_FANOUT_WIDTH).trim()}"`,
  ),
  `alias a${ALIAS_FANOUT_LEVELS} "unbindall"`,
  "bind mouse1 a1",
].join("\n");
