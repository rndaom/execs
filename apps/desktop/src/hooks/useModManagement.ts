import { useEffect, useState } from "react";
import type { Api } from "../lib/api";
import type { ModUpdateStatus, ProfileSummary } from "../lib/bridge";

/** Read results belong to this profile and pack snapshot, never a later selection. */
export function useModManagement(
  api: Api,
  active: boolean,
  profileId: string | null,
  revision: string,
) {
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{
    identity: string;
    profiles: ProfileSummary[];
    updates: ModUpdateStatus[];
    loading: boolean;
    error: string | null;
  }>({ identity: "", profiles: [], updates: [], loading: false, error: null });
  const identity = JSON.stringify([profileId, revision, refresh]);
  useEffect(() => {
    if (!active || !profileId) return;
    let current = true;
    setState({ identity, profiles: [], updates: [], loading: true, error: null });
    void Promise.allSettled([api.getProfileLibrary(), api.checkModUpdates()]).then(
      ([library, updates]) => {
        if (!current) return;
        setState({
          identity,
          profiles:
            library.status === "fulfilled"
              ? library.value.profiles.filter(
                  (profile) =>
                    profile.id !== profileId && profile.id !== library.value.activeProfileId,
                )
              : [],
          updates: updates.status === "fulfilled" ? updates.value : [],
          loading: false,
          error:
            library.status === "rejected" || updates.status === "rejected"
              ? "Some profile or update information could not be loaded. Try again."
              : null,
        });
      },
    );
    return () => {
      current = false;
    };
  }, [api, active, profileId, identity]);
  return {
    ...(state.identity === identity
      ? state
      : { profiles: [], updates: [], loading: active, error: null }),
    refresh: () => setRefresh((value) => value + 1),
  };
}
