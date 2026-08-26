import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SNAPSHOT = {
  managedPrefix: "https://sub.example.com",
  clashRuleBase: "base/rules",
  cacheTtlMs: 60000,
  defaultTarget: "clash",
  enableInsert: true,
  _note: "Read-only buildSettings snapshot. Edits write to KV_ADMIN:config:overlay via allowlist.",
};

type OverlayKey = "cacheTtlMs" | "defaultTarget" | "managedPrefix";
const ALLOWLIST: { key: OverlayKey; label: string; placeholder: string }[] = [
  { key: "cacheTtlMs", label: "Cache TTL (ms)", placeholder: "60000" },
  { key: "defaultTarget", label: "Default target", placeholder: "clash" },
  { key: "managedPrefix", label: "Managed prefix", placeholder: "https://sub.example.com" },
];

export default function ConfigPage() {
  const [snapshot] = useState(() => JSON.stringify(SNAPSHOT, null, 2));
  const [overlay, setOverlay] = useState<Record<OverlayKey, string>>({
    cacheTtlMs: "",
    defaultTarget: "",
    managedPrefix: "",
  });
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleCopy() {
    await navigator.clipboard.writeText(snapshot);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleSave() {
    setSaveError(null);
    const payload: Record<string, string> = {};
    for (const { key } of ALLOWLIST) {
      const v = overlay[key].trim();
      if (v) payload[key] = v;
    }
    if (Object.keys(payload).length === 0) {
      setSaveError("Enter at least one value to save to overlay.");
      return;
    }
    if (payload.cacheTtlMs && Number.isNaN(Number(payload.cacheTtlMs))) {
      setSaveError("Cache TTL must be a number (ms).");
      return;
    }
    // In production this POSTs to /dashboard/api/config/overlay
    // Here we simulate success; parent can wire to real endpoint later
    try {
      const existing = JSON.parse(localStorage.getItem("kv_admin_config_overlay") ?? "{}");
      localStorage.setItem("kv_admin_config_overlay", JSON.stringify({ ...existing, ...payload }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaveError("Save failed. Check browser storage.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Config</h1>
        <p className="text-sm text-[rgb(0_0_0/44%)]">buildSettings snapshot — read-only with controlled overlay.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Settings snapshot</CardTitle>
          <CardDescription>JSON mono + copy. Edits write to KV_ADMIN:config:overlay.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="overflow-auto rounded-[8px] border bg-zinc-50 p-4 font-mono text-xs leading-relaxed">{snapshot}</pre>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <span className="text-xs text-[rgb(0_0_0/44%)]">Read-only. Overlay overrides at runtime with allowlist keys only.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controlled overlay</CardTitle>
          <CardDescription>
            Whitelist keys only. Saved to <span className="font-mono text-xs">KV_ADMIN:config:overlay</span>. Empty values are ignored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {ALLOWLIST.map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-xs font-medium text-[rgb(0_0_0/64%)]" htmlFor={`overlay-${key}`}>
                  {label} <span className="font-mono text-[11px] text-[rgb(0_0_0/44%)]">({key})</span>
                </label>
                <Input
                  id={`overlay-${key}`}
                  placeholder={placeholder}
                  value={overlay[key]}
                  onChange={(e) => setOverlay((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          {saveError ? <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</div> : null}
          {saved ? <div className="rounded-[8px] border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Overlay saved locally (KV_ADMIN:config:overlay in production).</div> : null}

          <div className="flex items-center gap-2">
            <Button onClick={handleSave}>Save overlay</Button>
            <Button
              variant="outline"
              onClick={() => {
                setOverlay({ cacheTtlMs: "", defaultTarget: "", managedPrefix: "" });
                setSaveError(null);
              }}
            >
              Clear
            </Button>
          </div>

          <p className="text-xs leading-relaxed text-[rgb(0_0_0/44%)]">
            Only keys in the allowlist are accepted. All other keys are rejected server-side. Snapshot remains the source of truth; overlay is merged at request time.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
