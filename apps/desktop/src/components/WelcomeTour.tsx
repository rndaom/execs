import { ArrowLeft, ArrowRight, Check } from "@phosphor-icons/react";
import { type KeyboardEvent, useRef, useState } from "react";
import { SETTINGS_TAB_LABELS, type SettingsTab } from "../lib/settings-ui";
import {
  type WelcomeOrigin,
  type WelcomeStepId,
  welcomeStepAfter,
  welcomeSteps,
} from "../lib/welcome-tour";
import { Modal } from "./ui/Modal";
import { SETTINGS_TAB_ICONS } from "./ui/tabIcons";

/**
 * The first-run welcome: four short steps over the ready app. Each step's
 * picture plays once when it opens and rests on its final frame, so reduced
 * motion shows the same picture with nothing moving.
 */
export function WelcomeTour({
  open,
  profileName,
  origin,
  offerComfig,
  onClose,
  onTryComfig,
}: {
  open: boolean;
  profileName: string | null;
  origin: WelcomeOrigin;
  /** The active profile does not use mastercomfig, so offer to try it. */
  offerComfig: boolean;
  onClose: () => void;
  onTryComfig: () => void;
}) {
  const steps = welcomeSteps(profileName, origin);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "back">("next");
  const primary = useRef<HTMLButtonElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  function go(delta: 1 | -1) {
    const next = welcomeStepAfter(index, delta, steps.length);
    if (next === index) return;
    setDirection(delta > 0 ? "next" : "back");
    setIndex(next);
    // Keep keyboard focus on the button that moves forward.
    requestAnimationFrame(() => primary.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    }
  }

  return (
    <Modal
      open={open}
      title="Welcome to execs"
      hideTitle
      testId="welcome-tour"
      className="welcome-tour"
      onClose={onClose}
      onDefaultAction={() => (last ? onClose() : go(1))}
      initialFocusRef={primary}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys page the tour; every action is also a button. */}
      <div className="welcome-body" onKeyDown={onKeyDown}>
        <div className="welcome-top">
          <ol className="welcome-progress" aria-label={`Step ${index + 1} of ${steps.length}`}>
            {steps.map((item, at) => (
              <li
                key={item.id}
                data-state={at === index ? "current" : at < index ? "done" : "upcoming"}
              />
            ))}
          </ol>
          {last ? null : (
            <button
              type="button"
              data-testid="welcome-skip"
              className="btn btn-quiet"
              onClick={onClose}
            >
              Skip
            </button>
          )}
        </div>

        <div
          key={step.id}
          className="welcome-stage"
          data-direction={direction}
          data-testid={`welcome-stage-${step.id}`}
          aria-hidden="true"
        >
          <WelcomePicture id={step.id} profileName={profileName} />
        </div>

        <div key={`copy-${step.id}`} className="welcome-copy" data-direction={direction}>
          <h2 className="welcome-title" aria-live="polite">
            {step.title}
          </h2>
          <p className="welcome-text">{step.body}</p>
        </div>

        <div className="welcome-actions">
          {index > 0 ? (
            <button
              type="button"
              data-testid="welcome-back"
              className="btn btn-ghost"
              onClick={() => go(-1)}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Back
            </button>
          ) : (
            <span />
          )}
          <div className="welcome-actions-end">
            {last && offerComfig ? (
              <button
                type="button"
                data-testid="welcome-try-comfig"
                className="btn btn-ghost"
                onClick={onTryComfig}
              >
                Try mastercomfig in a new profile
              </button>
            ) : null}
            <button
              ref={primary}
              type="button"
              data-testid={last ? "welcome-done" : "welcome-next"}
              className="btn btn-primary"
              onClick={() => (last ? onClose() : go(1))}
            >
              {last ? "Get started" : "Next"}
              {last ? null : <ArrowRight size={14} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

const SIDEBAR: { group: string; tabs: SettingsTab[] }[] = [
  { group: "Setup", tabs: ["comfig", "binds"] },
  { group: "Look", tabs: ["hud", "crosshair", "sounds"] },
];

function WelcomePicture({ id, profileName }: { id: WelcomeStepId; profileName: string | null }) {
  const name = profileName?.trim() || "My setup";
  switch (id) {
    case "saved":
      return (
        <div className="wp-saved">
          <div className="wp-card wp-card-rise">
            <span className="wp-avatar">{name.charAt(0).toUpperCase()}</span>
            <span className="wp-card-text">
              <span className="wp-card-name">{name}</span>
              <span className="wp-card-meta">Active profile</span>
            </span>
            <span className="wp-check">
              <Check size={12} weight="bold" />
            </span>
          </div>
          <span className="wp-dot wp-dot-pop" />
        </div>
      );
    case "sidebar":
      return (
        <div className="wp-sidebar">
          <div className="wp-rail">
            <span className="wp-highlight" />
            {SIDEBAR.map((section) => (
              <div key={section.group} className="wp-group">
                <span className="wp-group-label">{section.group}</span>
                {section.tabs.map((tab) => {
                  const Icon = SETTINGS_TAB_ICONS[tab];
                  return (
                    <span key={tab} className="wp-tab" data-tab={tab}>
                      <Icon size={13} />
                      {SETTINGS_TAB_LABELS[tab]}
                      {tab === "sounds" ? <span className="wp-dot wp-dot-late" /> : null}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      );
    case "profiles":
      return (
        <div className="wp-profiles">
          <div className="wp-swap">
            <div className="wp-card wp-card-a">
              <span className="wp-avatar">{name.charAt(0).toUpperCase()}</span>
              <span className="wp-card-text">
                <span className="wp-card-name">{name}</span>
                <span className="wp-card-meta">Your setup</span>
              </span>
            </div>
            <div className="wp-card wp-card-b">
              <span className="wp-avatar wp-avatar-alt">M</span>
              <span className="wp-card-text">
                <span className="wp-card-name">Trying mastercomfig</span>
                <span className="wp-card-meta">New profile</span>
              </span>
            </div>
          </div>
        </div>
      );
    case "closed":
      return (
        <div className="wp-closed">
          <span className="wp-pill">
            <span className="wp-pill-layer wp-pill-running">
              <span className="wp-led wp-led-warn" />
              TF2 is running
            </span>
            <span className="wp-pill-layer wp-pill-closed">
              <span className="wp-led wp-led-ok" />
              TF2 closed
            </span>
          </span>
          <span className="wp-change">
            <span className="wp-change-layer wp-change-waiting">Crosshair change waiting</span>
            <span className="wp-change-layer wp-change-saved">
              <Check size={12} weight="bold" />
              Saved to your profile
            </span>
          </span>
        </div>
      );
  }
}
