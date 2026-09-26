/** The execs app icon drawn in markup: a dark tile, the orange block and the "e". */
export function AppMark({ size = 32 }: { size?: number }) {
  return (
    <span aria-hidden="true" className="app-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size} height={size} focusable="false" aria-hidden="true">
        <defs>
          <linearGradient id="app-mark-tile" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#262320" />
            <stop offset="1" stopColor="#161412" />
          </linearGradient>
          <linearGradient id="app-mark-block" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e69a61" />
            <stop offset="1" stopColor="#cf733a" />
          </linearGradient>
        </defs>
        <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="url(#app-mark-tile)" />
        <rect
          x="0.5"
          y="0.5"
          width="31"
          height="31"
          rx="8"
          fill="none"
          stroke="rgb(255 247 238 / 0.09)"
        />
        <rect x="6" y="9.5" width="5.5" height="5.5" rx="1.4" fill="url(#app-mark-block)" />
        <text
          x="19.5"
          y="24"
          textAnchor="middle"
          fill="#efe9df"
          fontFamily="Inter, sans-serif"
          fontSize="18"
          fontWeight="600"
        >
          e
        </text>
      </svg>
    </span>
  );
}
