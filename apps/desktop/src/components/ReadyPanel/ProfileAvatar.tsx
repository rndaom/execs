/**
 * A profile's monogram tile. The hue comes from the name, so each profile keeps
 * the same recognisable colour everywhere it appears; every tone stays in the
 * warm family around the accent.
 */
const TONES = [
  ["#d98449", "#2a1c12"],
  ["#c9a36b", "#262015"],
  ["#b8735f", "#281915"],
  ["#9fae7c", "#1d2116"],
  ["#8fa3b0", "#181e22"],
  ["#c68a8a", "#271a1a"],
] as const;

function monogram(name: string) {
  const letters = Array.from(name.trim()).filter((character) => /[\p{L}\p{N}]/u.test(character));
  return (letters[0] ?? "?").toLocaleUpperCase();
}

function tone(name: string) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return TONES[hash % TONES.length];
}

export function ProfileAvatar({
  name,
  size = 28,
  active = false,
}: {
  name: string;
  size?: number;
  active?: boolean;
}) {
  const [ink, ground] = tone(name);
  return (
    <span
      aria-hidden="true"
      className="profile-avatar"
      data-active={active ? "true" : undefined}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.46),
        color: ink,
        background: `linear-gradient(160deg, color-mix(in srgb, ${ink} 22%, ${ground}), ${ground})`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${ink} 35%, transparent)`,
      }}
    >
      {monogram(name)}
    </span>
  );
}
