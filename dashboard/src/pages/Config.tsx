import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectItem } from "@/components/ui/select";

type OverlayKey =
  | "API_MODE"
  | "API_TOKEN"
  | "DEFAULT_URL"
  | "MANAGED_PREFIX"
  | "FRONTEND_ALLOWLIST"
  | "RETENTION_DAYS";

type AllowlistEntry = {
  key: OverlayKey;
  label: string;
  placeholder: string;
  description: string;
  control: "select" | "password" | "text" | "textarea";
  options?: string[];
};

const ALLOWLIST: AllowlistEntry[] = [
  {
    key: "API_MODE",
    label: "接口模式",
    placeholder: "true",
    description: "启用接口模式 — 真 / 假",
    control: "select",
    options: ["true", "false"],
  },
  {
    key: "API_TOKEN",
    label: "接口令牌",
    placeholder: "••••••••",
    description: "用于 /sub 与面板鉴权的 Bearer 令牌",
    control: "password",
  },
  {
    key: "DEFAULT_URL",
    label: "默认链接",
    placeholder: "https://sub.ctelspecu.hxcn.top/sub.txt",
    description: "当 ?url 为空时的备用订阅链接",
    control: "text",
  },
  {
    key: "MANAGED_PREFIX",
    label: "管理前缀",
    placeholder: "https://sub.ctelspecu.hxcn.top",
    description: "用于写入托管配置的前缀",
    control: "text",
  },
  {
    key: "FRONTEND_ALLOWLIST",
    label: "前端白名单",
    placeholder: "https://sub.ctelspecu.hxcn.top, https://scd.ctelspecu.hxcn.top",
    description: "逗号分隔的允许源（为空则放行全部）",
    control: "textarea",
  },
  {
    key: "RETENTION_DAYS",
    label: "保留天数",
    placeholder: "180",
    description: "日志保留周期 — 7 / 30 / 90 / 180 / 365 天",
    control: "select",
    options: ["7", "30", "90", "180", "365"],
  },
];

const FALLBACK_SNAPSHOT = {
  apiMode: true,
  apiAccessToken: "***",
  defaultUrls: "",
  managedConfigPrefix: "http://127.0.0.1:25500",
  frontendAllowlist: "",
  retentionDays: 180,
  _note: "只读构建设置快照，修改写入 KV_ADMIN:config:overlay 白名单。",
};

export default function ConfigPage() {
  const [snapshotObj, setSnapshotObj] = useState<Record<string, unknown>>(FALLBACK_SNAPSHOT as Record<string, unknown>);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const [overlay, setOverlay] = useState<Record<OverlayKey, string>>({
    API_MODE: "",
    API_TOKEN: "",
    DEFAULT_URL: "",
    MANAGED_PREFIX: "",
    FRONTEND_ALLOWLIST: "",
    RETENTION_DAYS: "",
  });
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const snapshotText = JSON.stringify(snapshotObj, null, 2);

  useEffect(() => {
    let cancelled = false;
    async function fetchConfig() {
      try {
        setSnapshotLoading(true);
        setSnapshotError(null);
        const headers: Record<string, string> = {};
        const token =
          localStorage.getItem("dashboard_token") ??
          localStorage.getItem("auth_token") ??
          localStorage.getItem("DASHBOARD_TOKEN") ??
          "";
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/dashboard/api/config", { headers });
        if (!res.ok) throw new Error(`请求失败 ${res.status}`);
        const data = (await res.json()) as { settings?: Record<string, unknown>; overlay?: Record<string, unknown> };
        if (cancelled) return;
        // merge settings + overlay for display, keep overlay separate note
        const merged: Record<string, unknown> = {
          ...(data.settings ?? {}),
          ...(data.overlay ? { _overlay: data.overlay } : {}),
        };
        // if backend returns empty settings, fallback to at least show fetched shape
        if (Object.keys(merged).length === 0) {
          setSnapshotObj(FALLBACK_SNAPSHOT as Record<string, unknown>);
        } else {
          // ensure _note present
          if (!("_note" in merged)) {
            (merged as Record<string, unknown>)._note =
              "只读构建设置快照，修改写入 KV_ADMIN:config:overlay 白名单。";
          }
          setSnapshotObj(merged);
        }
        // hydrate overlay fields if backend already has overlay values
        if (data.overlay && typeof data.overlay === "object") {
          setOverlay((prev) => {
            const next = { ...prev };
            for (const { key } of ALLOWLIST) {
              const v = (data.overlay as Record<string, unknown>)[key];
              if (v !== undefined && v !== null) next[key] = String(v);
            }
            return next;
          });
        }
      } catch (e) {
        if (cancelled) return;
        setSnapshotError(e instanceof Error ? e.message : "获取配置失败");
        // keep fallback snapshot visible
      } finally {
        if (!cancelled) setSnapshotLoading(false);
      }
    }
    fetchConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCopy() {
    await navigator.clipboard.writeText(snapshotText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleSave() {
    setSaveError(null);
    setSaved(false);

    const payload: Record<string, string> = {};
    for (const { key } of ALLOWLIST) {
      const v = overlay[key].trim();
      if (v) payload[key] = v;
    }
    if (Object.keys(payload).length === 0) {
      setSaveError("Enter at least one value to save to overlay.");
      return;
    }
    if (payload.API_MODE && !["true", "false"].includes(payload.API_MODE)) {
      setSaveError("API_MODE must be true or false.");
      return;
    }
    if (payload.RETENTION_DAYS && !["7", "30", "90", "180", "365"].includes(payload.RETENTION_DAYS)) {
      setSaveError("Retention must be one of 7, 30, 90, 180, 365.");
      return;
    }

    setSaving(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token =
        localStorage.getItem("dashboard_token") ??
        localStorage.getItem("auth_token") ??
        localStorage.getItem("DASHBOARD_TOKEN") ??
        "";
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch("/dashboard/api/config", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        const msg = (body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message ?? `保存失败 (${res.status})`;
        setSaveError(String(msg));
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);

      // refresh snapshot to reflect newly applied overlay
      try {
        const r = await fetch("/dashboard/api/config", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (r.ok) {
          const data = (await r.json()) as { settings?: Record<string, unknown>; overlay?: Record<string, unknown> };
          const merged: Record<string, unknown> = {
            ...(data.settings ?? {}),
            ...(data.overlay ? { _overlay: data.overlay } : {}),
          };
          if (Object.keys(merged).length > 0) {
            if (!("_note" in merged)) {
              (merged as Record<string, unknown>)._note =
                "只读构建设置快照，修改写入 KV_ADMIN:config:overlay 白名单。";
            }
            setSnapshotObj(merged);
          }
        }
      } catch {
        // ignore refresh failure
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存失败. Check network.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">配置</h1>
        <p className="text-sm text-[rgb(0_0_0/44%)]">构建设置快照 — 只读，支持受控覆盖。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>配置快照</CardTitle>
          <CardDescription>JSON 等宽 + 复制，修改写入 KV_ADMIN:config:overlay。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {snapshotLoading ? (
            <div className="rounded-[8px] border bg-zinc-50 p-4 text-sm text-[rgb(0_0_0/44%)]">Loading snapshot from /dashboard/api/config…</div>
          ) : (
            <pre className="overflow-auto rounded-[8px] border bg-zinc-50 p-4 font-mono text-xs leading-relaxed">{snapshotText}</pre>
          )}
          {snapshotError ? (
            <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Could not fetch live snapshot ({snapshotError}) — showing fallback.
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleCopy}>
              {copied ? "已复制" : "复制"}
            </Button>
            <span className="text-xs text-[rgb(0_0_0/44%)]">只读，覆盖在运行时通过白名单键生效。</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>受控覆盖</CardTitle>
          <CardDescription>
            白名单 keys only. Saved to <span className="font-mono text-xs">KV_ADMIN:config:overlay</span>. Empty values are ignored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {ALLOWLIST.map(({ key, label, placeholder, description, control, options }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-xs font-medium text-[rgb(0_0_0/64%)]" htmlFor={`overlay-${key}`}>
                  {label} <span className="font-mono text-[11px] text-[rgb(0_0_0/44%)]">({key})</span>
                </label>
                {control === "select" ? (
                  <Select
                    id={`overlay-${key}`}
                    value={overlay[key]}
                    onChange={(e) => setOverlay((prev) => ({ ...prev, [key]: e.target.value }))}
                    onValueChange={(v) => setOverlay((prev) => ({ ...prev, [key]: v }))}
                  >
                    <option value="">{placeholder ? `Select — e.g. ${placeholder}` : "Select…"}</option>
                    {options?.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </Select>
                ) : control === "textarea" ? (
                  <Textarea
                    id={`overlay-${key}`}
                    placeholder={placeholder}
                    value={overlay[key]}
                    onChange={(e) => setOverlay((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="min-h-[84px]"
                  />
                ) : control === "password" ? (
                  <Input
                    id={`overlay-${key}`}
                    type="password"
                    placeholder={placeholder}
                    value={overlay[key]}
                    onChange={(e) => setOverlay((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                ) : (
                  <Input
                    id={`overlay-${key}`}
                    placeholder={placeholder}
                    value={overlay[key]}
                    onChange={(e) => setOverlay((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                )}
                <p className="text-[11px] leading-relaxed text-[rgb(0_0_0/44%)]">{description}</p>
              </div>
            ))}
          </div>

          {saveError ? <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</div> : null}
          {saved ? (
            <div className="rounded-[8px] border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              Overlay saved to KV_ADMIN:config:overlay — next request reads the new values.
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : "保存覆盖"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setOverlay({
                  API_MODE: "",
                  API_TOKEN: "",
                  DEFAULT_URL: "",
                  MANAGED_PREFIX: "",
                  FRONTEND_ALLOWLIST: "",
                  RETENTION_DAYS: "",
                });
                setSaveError(null);
                setSaved(false);
              }}
            >
              清空
            </Button>
          </div>

          <p className="text-xs leading-relaxed text-[rgb(0_0_0/44%)]">
            仅白名单中的键会被接受，其它键将被服务端拒绝；快照为源，覆盖在请求时合并。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
