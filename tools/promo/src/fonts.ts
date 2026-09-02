import { continueRender, delayRender, staticFile } from "remotion";

const WEIGHTS = [400, 500, 600, 700] as const;

let loaded: Promise<void> | null = null;

/** Load Inter from `public/fonts` once per render process. */
export function loadInter(): Promise<void> {
  if (loaded) {
    return loaded;
  }
  const handle = delayRender("Loading Inter");
  loaded = Promise.all(
    WEIGHTS.map((weight) => {
      const face = new FontFace(
        "Inter",
        `url(${staticFile(`fonts/inter-latin-${weight}-normal.woff2`)})`,
        {
          weight: String(weight),
        },
      );
      return face.load().then((f) => {
        (document.fonts as unknown as { add(face: FontFace): void }).add(f);
      });
    }),
  )
    .then(() => continueRender(handle))
    .catch((error) => {
      console.error(error);
      continueRender(handle);
    });
  return loaded;
}
