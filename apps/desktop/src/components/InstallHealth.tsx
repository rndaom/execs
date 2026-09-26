import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import { invokeErrorMessage } from "../lib/bridge";
import { type HealthStatus, healthItems, type InstallHealth } from "../lib/health-ui";
import { Loading } from "./ui/Spinner";

const STATUS_DOT: Record<HealthStatus, string> = {
  ok: "bg-ok",
  attention: "bg-warn",
  unknown: "bg-ink-faint",
};

const STATUS_LABEL: Record<HealthStatus, string> = {
  ok: "OK",
  attention: "Needs attention",
  unknown: "Unknown",
};

/** Read-only: every retry here only reads again. */
export function InstallHealthPanel({ api }: { api: Pick<Api, "getInstallHealth"> }) {
  const [health, setHealth] = useState<InstallHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const next = await api.getInstallHealth();
      if (id !== request.current) return;
      setHealth(next);
      setError(null);
    } catch (err) {
      if (id === request.current) setError(invokeErrorMessage(err));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  return (
    <div data-testid="install-health" aria-busy={loading}>
      {health ? (
        <ul className="divide-y divide-edge">
          {healthItems(health).map((item) => (
            <li
              key={item.id}
              data-testid={`health-${item.id}`}
              data-status={item.status}
              className="flex min-w-0 gap-3 py-2"
            >
              <span
                aria-hidden="true"
                className={`mt-[7px] size-2 shrink-0 rounded-full ${STATUS_DOT[item.status]}`}
              />
              <span className="min-w-0">
                <span className="t-row block">
                  {item.title}
                  <span className="sr-only">: {STATUS_LABEL[item.status]}</span>
                </span>
                {item.lines.map((line) => (
                  <span key={line} className="t-meta block break-words">
                    {line}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : loading ? (
        <p className="t-meta">
          <Loading>Checking your installation…</Loading>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="t-meta mt-2 text-error">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="btn btn-ghost mt-3"
        data-testid="health-refresh"
        disabled={loading}
        onClick={() => void load()}
      >
        {loading && health ? <Loading>Checking…</Loading> : "Check again"}
      </button>
    </div>
  );
}
