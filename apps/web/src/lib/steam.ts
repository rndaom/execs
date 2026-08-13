// Steam OpenID 2.0 sign-in + Web API profile fetch. Steam only supports
// OpenID 2.0 (no OAuth/OIDC); the flow yields exactly one datum: the steamid64.

const DEFAULT_OPENID_BASE = "https://steamcommunity.com";
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export function buildSteamLoginUrl(opts: {
  openidBase?: string;
  appUrl: string;
  state: string;
}): string {
  const base = opts.openidBase ?? DEFAULT_OPENID_BASE;
  const returnTo = new URL("/api/auth/steam/callback", opts.appUrl);
  returnTo.searchParams.set("state", opts.state);

  const url = new URL("/openid/login", base);
  url.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
  url.searchParams.set("openid.mode", "checkid_setup");
  url.searchParams.set("openid.return_to", returnTo.toString());
  url.searchParams.set("openid.realm", opts.appUrl);
  url.searchParams.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
  url.searchParams.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");
  return url.toString();
}

/**
 * Verifies the OpenID assertion by round-tripping it back to Steam with
 * mode=check_authentication. Returns the steamid64 or null.
 */
export async function verifySteamAssertion(
  params: URLSearchParams,
  openidBase = DEFAULT_OPENID_BASE,
): Promise<string | null> {
  const claimedId = params.get("openid.claimed_id");
  const match = claimedId?.match(CLAIMED_ID_RE);
  if (!match) return null;

  const body = new URLSearchParams();
  for (const [key, value] of params) {
    if (key.startsWith("openid.")) body.set(key, value);
  }
  body.set("openid.mode", "check_authentication");

  const res = await fetch(new URL("/openid/login", openidBase), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!/is_valid\s*:\s*true/.test(text)) return null;
  return match[1];
}

export interface SteamProfile {
  personaName: string;
  avatarUrl: string | null;
  profileUrl: string | null;
}

/**
 * Fetches persona/avatar from the Steam Web API. Fail-soft: returns a
 * placeholder profile when the key is missing or the call fails, so sign-in
 * never depends on the Web API being up.
 */
export async function fetchSteamProfile(
  steamId: string,
  apiKey: string | undefined,
): Promise<SteamProfile> {
  const fallback: SteamProfile = {
    personaName: `Player ${steamId.slice(-4)}`,
    avatarUrl: null,
    profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
  };
  if (!apiKey) return fallback;
  try {
    const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("steamids", steamId);
    const res = await fetch(url);
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      response?: { players?: Array<{ personaname?: string; avatarfull?: string; profileurl?: string }> };
    };
    const player = data.response?.players?.[0];
    if (!player) return fallback;
    return {
      personaName: player.personaname ?? fallback.personaName,
      avatarUrl: player.avatarfull ?? null,
      profileUrl: player.profileurl ?? fallback.profileUrl,
    };
  } catch {
    return fallback;
  }
}
