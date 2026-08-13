"use client";

import { type Finding, lint, type LintResult } from "@execs/cfglint";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES } from "@/db/schema";
import { defaultInstallPath } from "@/lib/upload";

interface PickedFile {
  name: string;
  bytes: Uint8Array;
  text: string | null; // null for zips (expanded server-side)
}

const CATEGORY_LABELS: Record<string, string> = {
  "full-setup": "Full setup",
  "class-config": "Class config",
  graphics: "Graphics / performance",
  network: "Network",
  binds: "Binds",
  scripts: "Scripts",
};

const TIER_STYLE: Record<string, string> = {
  block: "bg-destructive text-destructive-foreground",
  warn: "bg-q-strange text-on-brand",
  info: "bg-secondary text-secondary-foreground",
};

export function UploadWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [meta, setMeta] = useState({
    name: "",
    summary: "",
    description: "",
    category: "",
    versionLabel: "1.0",
  });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFindings, setServerFindings] = useState<Finding[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const lintResult: LintResult | null = useMemo(() => {
    const cfgs = picked.filter((f) => f.text !== null && f.name.toLowerCase().endsWith(".cfg"));
    if (cfgs.length === 0) return null;
    try {
      return lint(cfgs.map((f) => ({ path: f.name, text: f.text as string })));
    } catch {
      return null;
    }
  }, [picked]);

  const hasZip = picked.some((f) => f.name.toLowerCase().endsWith(".zip"));
  const blocked = lintResult?.findings.some((f) => f.tier === "block") ?? false;

  async function onPick(fileList: FileList | null) {
    if (!fileList) return;
    const next: PickedFile[] = [];
    for (const file of Array.from(fileList)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isText = /\.(cfg|txt|md)$/i.test(file.name);
      next.push({
        name: file.name,
        bytes,
        text: isText ? new TextDecoder().decode(bytes) : null,
      });
    }
    setPicked(next);
    setServerError(null);
    setServerFindings([]);
  }

  async function submit() {
    setSubmitting(true);
    setServerError(null);
    setServerFindings([]);
    try {
      const form = new FormData();
      form.set("name", meta.name);
      form.set("summary", meta.summary);
      form.set("description", meta.description);
      form.set("category", meta.category);
      form.set("versionLabel", meta.versionLabel);
      for (const f of picked) {
        form.append("files", new File([f.bytes as unknown as BlobPart], f.name));
      }
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = (await res.json()) as {
        error?: string;
        findings?: Finding[];
        slug?: string;
        status?: string;
      };
      if (!res.ok) {
        setServerError(data.error ?? "upload failed");
        setServerFindings(data.findings ?? []);
        return;
      }
      router.push(`/configs/${data.slug}?uploaded=${data.status}`);
    } catch {
      setServerError("network error — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <ol className="flex gap-2 text-xs text-ink-faint">
        {["Files", "Safety review", "Details"].map((label, i) => (
          <li
            key={label}
            className={`rounded-pill border px-3 py-1 ${step === i + 1 ? "border-brand text-brand" : "border-edge"}`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Choose your config files</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Select .cfg / .txt / .md files, or a single .zip. 4 MB max total. VPKs aren't
              supported yet.
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".cfg,.txt,.md,.zip"
              className="hidden"
              onChange={(e) => onPick(e.target.files)}
            />
            <Button variant="secondary" onClick={() => inputRef.current?.click()}>
              Select files
            </Button>
            {picked.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {picked.map((f) => (
                  <li key={f.name} className="flex justify-between border-b border-edge pb-1">
                    <span>{f.name}</span>
                    <span className="text-ink-faint">{(f.bytes.length / 1024).toFixed(1)} KB</span>
                  </li>
                ))}
              </ul>
            )}
            <Button disabled={picked.length === 0} onClick={() => setStep(2)}>
              Continue
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Safety review</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {hasZip && (
              <p className="text-sm text-muted-foreground">
                Zip contents are checked on the server after you submit.
              </p>
            )}
            {lintResult && (
              <>
                <div className="flex flex-col gap-1 text-sm">
                  <h3 className="font-semibold">Install layout</h3>
                  {picked
                    .filter((f) => !f.name.toLowerCase().endsWith(".zip"))
                    .map((f) => (
                      <div key={f.name} className="flex justify-between gap-4 border-b border-edge pb-1">
                        <span>{f.name}</span>
                        <code className="text-xs text-ink-faint">{defaultInstallPath(f.name)}</code>
                      </div>
                    ))}
                </div>
                {lintResult.findings.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {lintResult.findings.map((f, i) => (
                      <li key={`${f.ruleId}-${i}`} className="flex items-start gap-2 text-sm">
                        <Badge className={TIER_STYLE[f.tier]}>{f.tier}</Badge>
                        <span>
                          <code className="text-xs">{f.file}:{f.line}</code> {f.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-health">No safety findings — clean config.</p>
                )}
                {blocked && (
                  <p className="text-sm text-destructive">
                    Block-tier findings must be fixed before this config can be shared.
                  </p>
                )}
              </>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button disabled={blocked} onClick={() => setStep(3)}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={meta.name}
                maxLength={80}
                placeholder="e.g. Silky Smooth FPS Config"
                onChange={(e) => setMeta({ ...meta, name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="summary">One-line summary</Label>
              <Input
                id="summary"
                value={meta.summary}
                maxLength={200}
                placeholder="What does this config do, in one sentence?"
                onChange={(e) => setMeta({ ...meta, summary: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Category</Label>
              <Select
                value={meta.category}
                onValueChange={(v) => setMeta({ ...meta, category: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Description (markdown)</Label>
              <Textarea
                id="description"
                rows={6}
                value={meta.description}
                placeholder="What's in it, who it's for, credits…"
                onChange={(e) => setMeta({ ...meta, description: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="version">Version label</Label>
              <Input
                id="version"
                value={meta.versionLabel}
                maxLength={20}
                className="w-32"
                onChange={(e) => setMeta({ ...meta, versionLabel: e.target.value })}
              />
            </div>
            {serverError && (
              <div className="flex flex-col gap-2 rounded-md border border-destructive p-3 text-sm">
                <p className="text-destructive">{serverError}</p>
                {serverFindings.map((f, i) => (
                  <p key={`${f.ruleId}-${i}`}>
                    <code className="text-xs">{f.file}:{f.line}</code> {f.message}
                  </p>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                disabled={
                  submitting || meta.name.length < 3 || meta.summary.length < 10 || !meta.category
                }
                onClick={submit}
              >
                {submitting ? "Uploading…" : "Publish config"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
