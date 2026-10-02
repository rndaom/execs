import { type ReactNode, useEffect } from "react";
import { AbsoluteFill } from "remotion";
import { loadInter } from "./fonts";
import { EmblemHalftone } from "./Stills";
import { theme } from "./theme";
import { Wordmark } from "./Wordmark";

/*
 * The README's images, drawn in the app's own look: its page colour, panel,
 * Inter, the orange dot and the TF2 emblem in dots. Each sits in a rounded frame on
 * a transparent ground, so it reads on GitHub's light and dark themes alike.
 */

/** The rounded page every README image sits in. */
function Frame({ children }: { children: ReactNode }) {
  useEffect(() => {
    void loadInter();
  }, []);
  return (
    <AbsoluteFill style={{ fontFamily: theme.font, color: theme.ink }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 18,
          overflow: "hidden",
          background: theme.bg,
          boxShadow: `inset 0 0 0 1px ${theme.edge}`,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}

const PANES = [
  "Profiles",
  "Comfig",
  "Binds",
  "HUD",
  "Crosshair",
  "Viewmodels",
  "Sounds",
  "Mods",
  "Files",
  "Inventory",
] as const;

export const HEADER = { width: 1600, height: 500 } as const;

/** readme-header.png: the wordmark and the promise beside the TF2 emblem in dots. */
export function ReadmeHeader() {
  return (
    <Frame>
      <div
        style={{
          position: "absolute",
          right: -110,
          top: -70,
          opacity: 0.8,
          // Dissolve toward the text, as the app's backdrop does.
          maskImage: "linear-gradient(to right, transparent 0%, black 55%)",
        }}
      >
        <EmblemHalftone size={640} />
      </div>
      <div style={{ position: "absolute", left: 92, top: 112, display: "flex" }}>
        <Wordmark size={92} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 250,
          width: 820,
          fontSize: 40,
          fontWeight: 600,
          letterSpacing: "-0.025em",
          lineHeight: 1.2,
        }}
      >
        Your Team Fortress 2 setup as profiles. Switch in one click.
      </div>
      <div
        style={{ position: "absolute", left: 96, top: 356, fontSize: 22, color: theme.inkFaint }}
      >
        Free and open source for Windows and Linux
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          bottom: 44,
          display: "flex",
          gap: 22,
          fontSize: 17,
          fontWeight: 500,
          color: theme.inkFaint,
          letterSpacing: "0.01em",
        }}
      >
        {PANES.map((pane) => (
          <span key={pane}>{pane}</span>
        ))}
      </div>
    </Frame>
  );
}

export const INSTALL = { width: 1600, height: 600 } as const;

function Ring({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        padding: 4,
        margin: -6,
        borderRadius: 10,
        boxShadow: `0 0 0 2.5px ${theme.brand}`,
      }}
    >
      {children}
    </span>
  );
}

function Button({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 46,
        padding: "0 26px",
        borderRadius: 6,
        fontSize: 21,
        fontWeight: 500,
        background: primary ? theme.brand : theme.panelRaised,
        color: primary ? theme.onBrand : theme.ink,
        boxShadow: primary ? "none" : `inset 0 0 0 1px ${theme.edge}`,
      }}
    >
      {children}
    </span>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: "0.14em",
          color: theme.brand,
        }}
      >
        STEP {number}
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 31,
          fontWeight: 600,
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 26,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "34px 40px 32px",
          borderRadius: 12,
          background: theme.panel,
          boxShadow: `inset 0 0 0 1px ${theme.edge}`,
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.015em" }}>
          Windows protected your PC
        </div>
        {children}
      </div>
    </div>
  );
}

const orange = (text: string) => <span style={{ color: theme.brand }}>{text}</span>;

/** readme-install.png: getting past SmartScreen in two clicks. */
export function ReadmeInstall() {
  return (
    <Frame>
      <div
        style={{
          position: "absolute",
          inset: "56px 64px 0",
          display: "flex",
          gap: 48,
          height: 430,
        }}
      >
        <Step number={1} title={<>Windows shows this. Click {orange("More info")}.</>}>
          <div style={{ marginTop: 16, fontSize: 21, lineHeight: 1.5, color: theme.inkMuted }}>
            Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this
            app might put your PC at risk.
          </div>
          <div style={{ marginTop: 18, fontSize: 21 }}>
            <Ring>
              <span style={{ textDecoration: "underline", textUnderlineOffset: 4 }}>More info</span>
            </Ring>
          </div>
          <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
            <Button>Don't run</Button>
          </div>
        </Step>
        <Step number={2} title={<>Click {orange("Run anyway")}. The installer starts.</>}>
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              columnGap: 14,
              rowGap: 6,
              fontSize: 21,
              color: theme.inkMuted,
            }}
          >
            <span>App:</span>
            <span style={{ color: theme.ink }}>execs_…_x64-setup.exe</span>
            <span>Publisher:</span>
            <span style={{ color: theme.ink }}>Unknown publisher</span>
          </div>
          <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end", gap: 14 }}>
            <Ring>
              <Button primary>Run anyway</Button>
            </Ring>
            <Button>Don't run</Button>
          </div>
        </Step>
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          bottom: 40,
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 19,
          color: theme.inkFaint,
        }}
      >
        <span
          style={{ width: 8, height: 8, borderRadius: 8, background: theme.brand, flex: "none" }}
        />
        Only for the installer from github.com/rndaom/execs/releases. The warning can return with
        each new version.
      </div>
    </Frame>
  );
}
