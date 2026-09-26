import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { Api } from "../../lib/api";
import { emblemMaskUrl } from "../../lib/class-icons";

type ClassIconMap = Readonly<Record<string, string>>;

const ClassIcons = createContext<ClassIconMap>({});

/**
 * Loads TF2's class emblems from the confirmed install once and shares them.
 * A failed read leaves the map empty; every caller then shows text alone.
 */
export function ClassIconProvider({
  api,
  installPath,
  children,
}: {
  api: Pick<Api, "getClassIcons">;
  /** Reload only when the confirmed install changes. */
  installPath: string;
  children: ReactNode;
}) {
  const [icons, setIcons] = useState<ClassIconMap>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different confirmed install has different game files.
  useEffect(() => {
    let current = true;
    setIcons({});
    void api
      .getClassIcons()
      .then((sprites) => {
        if (!current) return;
        const next: Record<string, string> = {};
        for (const [id, sprite] of Object.entries(sprites)) {
          const url = emblemMaskUrl(sprite);
          if (url) next[id] = url;
        }
        setIcons(next);
      })
      .catch(() => {
        if (current) setIcons({});
      });
    return () => {
      current = false;
    };
  }, [api, installPath]);
  return <ClassIcons.Provider value={icons}>{children}</ClassIcons.Provider>;
}

/** A flat TF2 class emblem in the current text colour, or nothing if unavailable. */
export function ClassIcon({ classId, size = 16 }: { classId: string; size?: number }) {
  const url = useContext(ClassIcons)[classId];
  if (!url) return null;
  return (
    <span
      aria-hidden="true"
      className="class-emblem"
      style={{
        width: size,
        height: size,
        maskImage: `url("${url}")`,
        WebkitMaskImage: `url("${url}")`,
      }}
    />
  );
}
