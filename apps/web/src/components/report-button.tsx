"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const REASONS = [
  ["malicious", "Malicious or unsafe"],
  ["stolen", "Stolen / reposted without credit"],
  ["not-tf2", "Not TF2 related"],
  ["inappropriate-media", "Inappropriate media"],
  ["other", "Other"],
] as const;

export function ReportButton({ configId }: { configId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("malicious");
  const [detail, setDetail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setState("sending");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId, reason, detail }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(data.error ?? "could not send report");
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setMessage("network error");
      setState("error");
    }
  }

  if (state === "done") {
    return <p className="text-xs text-ink-faint">Report sent — thanks for keeping execs safe.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-ink-faint underline hover:text-ink-muted"
      >
        Report this config
      </button>
    );
  }

  return (
    <div className="flex max-w-md flex-col gap-2 rounded-md border border-edge bg-panel p-3 text-sm">
      <p className="font-semibold">Report this config</p>
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="rounded border border-edge bg-background p-1.5 text-sm"
      >
        {REASONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="Anything the moderators should know (optional)"
        rows={2}
        className="rounded border border-edge bg-background p-1.5 text-sm"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send report"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}
