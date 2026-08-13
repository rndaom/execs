import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSteamLoginUrl, fetchSteamProfile, verifySteamAssertion } from "./steam";

const STEAM_ID = "76561197960287930";

function assertionParams(claimedId: string): URLSearchParams {
  return new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.claimed_id": claimedId,
    "openid.sig": "sig",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSteamLoginUrl", () => {
  it("targets Steam with OpenID 2.0 checkid_setup and carries state in return_to", () => {
    const url = new URL(
      buildSteamLoginUrl({ appUrl: "https://execs.tf", state: "nonce123" }),
    );
    expect(url.origin).toBe("https://steamcommunity.com");
    expect(url.pathname).toBe("/openid/login");
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(url.searchParams.get("openid.realm")).toBe("https://execs.tf");
    const returnTo = new URL(url.searchParams.get("openid.return_to") ?? "");
    expect(returnTo.pathname).toBe("/api/auth/steam/callback");
    expect(returnTo.searchParams.get("state")).toBe("nonce123");
  });
});

describe("verifySteamAssertion", () => {
  it("accepts a valid assertion and extracts the steamid64", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n")),
    );
    const id = await verifySteamAssertion(
      assertionParams(`https://steamcommunity.com/openid/id/${STEAM_ID}`),
    );
    expect(id).toBe(STEAM_ID);
    // The round-trip must flip mode to check_authentication.
    const body = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain("openid.mode=check_authentication");
  });

  it("rejects when Steam says is_valid:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("is_valid:false\n")));
    const id = await verifySteamAssertion(
      assertionParams(`https://steamcommunity.com/openid/id/${STEAM_ID}`),
    );
    expect(id).toBeNull();
  });

  it.each([
    "https://evil.example/openid/id/76561197960287930",
    "https://steamcommunity.com/openid/id/123",
    "https://steamcommunity.com/openid/id/76561197960287930/extra",
    "",
  ])("rejects malformed claimed_id %s without calling Steam", async (claimedId) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const id = await verifySteamAssertion(assertionParams(claimedId));
    expect(id).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchSteamProfile", () => {
  it("returns placeholder profile without an API key", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const profile = await fetchSteamProfile(STEAM_ID, undefined);
    expect(profile.personaName).toBe("Player 7930");
    expect(profile.profileUrl).toContain(STEAM_ID);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns Web API data when available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              response: {
                players: [
                  {
                    personaname: "Saxton",
                    avatarfull: "https://avatars.example/a.jpg",
                    profileurl: "https://steamcommunity.com/id/saxton/",
                  },
                ],
              },
            }),
          ),
      ),
    );
    const profile = await fetchSteamProfile(STEAM_ID, "key");
    expect(profile).toEqual({
      personaName: "Saxton",
      avatarUrl: "https://avatars.example/a.jpg",
      profileUrl: "https://steamcommunity.com/id/saxton/",
    });
  });

  it("fails soft when the Web API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const profile = await fetchSteamProfile(STEAM_ID, "key");
    expect(profile.personaName).toBe("Player 7930");
  });
});
