/**
 * The execs wordmark: the orange dot and the name, sized in em so every copy
 * (header, onboarding, startup screen) is the same shape at any size. The
 * startup screen's wordmark travels to the one marked `data-wordmark`.
 */
export function Wordmark({
  size = 18,
  className = "",
  target = false,
}: {
  size?: number;
  className?: string;
  /** Where the startup wordmark lands when it leaves. */
  target?: boolean;
}) {
  return (
    <p
      className={`wordmark ${className}`.trim()}
      style={{ fontSize: size }}
      data-wordmark={target ? "" : undefined}
    >
      <span aria-hidden="true" className="wordmark-dot" data-wordmark-dot="" />
      execs
    </p>
  );
}
