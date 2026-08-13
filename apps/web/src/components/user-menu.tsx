import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";

/**
 * Header auth area. Uses Valve's official "Sign in through Steam" button per
 * Steam Web API branding terms.
 */
export async function UserMenu() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <a href="/api/auth/steam" className="inline-block">
        {/* biome-ignore lint/performance/noImgElement: official Steam asset, no optimizer on Workers */}
        <img
          src="https://community.cloudflare.steamstatic.com/public/images/signinthroughsteam/sits_01.png"
          alt="Sign in through Steam"
          width={109}
          height={66}
          className="h-8 w-auto"
        />
      </a>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Link
        href={`/u/${user.steamId}`}
        className="flex items-center gap-2 text-sm text-ink-muted hover:text-ink"
      >
        {user.avatarUrl ? (
          // biome-ignore lint/performance/noImgElement: avatar from Steam CDN, no optimizer on Workers
          <img
            src={user.avatarUrl}
            alt=""
            width={24}
            height={24}
            className="size-6 rounded-full border border-edge"
          />
        ) : (
          <span className="size-6 rounded-full bg-panel-raised" />
        )}
        {user.personaName}
      </Link>
      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="rounded-pill border border-edge px-3 py-1 text-xs text-ink-muted hover:border-ink-muted hover:text-ink"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
