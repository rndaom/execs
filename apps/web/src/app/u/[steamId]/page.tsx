import { notFound } from "next/navigation";
import { ConfigCard } from "@/components/config-card";
import { getUserProfile } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ steamId: string }>;
}) {
  const { steamId } = await params;
  if (!/^\d{17}$/.test(steamId)) notFound();
  const profile = await getUserProfile(steamId);
  if (!profile) notFound();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        {profile.user.avatarUrl ? (
          // biome-ignore lint/performance/noImgElement: Steam CDN avatar
          <img
            src={profile.user.avatarUrl}
            alt=""
            width={64}
            height={64}
            className="size-16 rounded-lg border border-edge"
          />
        ) : (
          <div className="size-16 rounded-lg bg-panel-raised" />
        )}
        <div>
          <h1 className="font-display text-3xl">{profile.user.personaName}</h1>
          <a
            href={profile.user.profileUrl ?? `https://steamcommunity.com/profiles/${steamId}`}
            className="text-sm text-ink-faint underline hover:text-ink-muted"
            rel="noreferrer"
            target="_blank"
          >
            Steam profile ↗
          </a>
        </div>
      </header>
      <section>
        <h2 className="mb-3 font-display text-xl">
          Configs ({profile.uploads.length})
        </h2>
        {profile.uploads.length === 0 ? (
          <p className="text-ink-faint">No configs shared yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {profile.uploads.map((c) => (
              <ConfigCard key={c.id} config={c} ownerName={profile.user.personaName} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
