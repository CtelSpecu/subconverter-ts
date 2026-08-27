import { useEffect, useState } from "react";
import { getToken } from "@/lib/auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

const TARGETS = [
  "clash",
  "clashr",
  "surge",
  "quan",
  "quanx",
  "loon",
  "surfboard",
  "mellow",
  "ss",
  "ssr",
  "v2ray",
  "trojan",
  "mixed",
  "ssd",
  "singbox",
  "sssub",
] as const;

const REMOTE_CONFIGS = [
  { value: "", label: "默认（无远程配置）" },
  { value: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini", label: "ACL4SSR — Online" },
  { value: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini.ini", label: "ACL4SSR — Mini" },
  { value: "custom", label: "自定义链接…" },
] as const;

export default function GeneratePage() {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState<(typeof TARGETS)[number]>("clash");
  const [config, setConfig] = useState("");
  const [customConfig, setCustomConfig] = useState("");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [filename, setFilename] = useState("");
  const [customParams, setCustomParams] = useState("");
  const [emoji, setEmoji] = useState(false);
  const [scv, setScv] = useState(false);
  const [udp, setUdp] = useState(false);
  const [appendType, setAppendType] = useState(false);
  const [sort, setSort] = useState(false);
  const [fdn, setFdn] = useState(false);
  const [expand, setExpand] = useState(false);
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const [showCustomConfig, setShowCustomConfig] = useState(false);

  const [backendBase, setBackendBase] = useState("https://sub.ctelspecu.hxcn.top");

  useEffect(() => {
    const t = getToken();
    const h: Record<string,string> = {};
    if (t) h.Authorization = `Bearer ${t}`;
    fetch("/dashboard/api/domains", { headers: h })
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => { if (d?.managedPrefix) setBackendBase(String(d.managedPrefix).replace(/\/$/, "")); })
      .catch(()=>{});
    fetch("/dashboard/api/config", { headers: h })
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        const mp = d?.overlay?.MANAGED_PREFIX || d?.settings?.managedConfigPrefix;
        if (mp) setBackendBase(String(mp).replace(/\/$/, ""));
      })
      .catch(()=>{});
  }, []);

  function handleGenerate() {
    const base = backendBase || "https://sub.ctelspecu.hxcn.top";
    const params = new URLSearchParams();

    const urls = source
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join("|");
    if (urls) params.set("url", urls);
    params.set("target", target);

    const effectiveConfig = config === "custom" ? customConfig.trim() : config.trim();
    if (effectiveConfig) params.set("config", effectiveConfig);

    if (include.trim()) params.set("include", include.trim());
    if (exclude.trim()) params.set("exclude", exclude.trim());
    if (filename.trim()) params.set("filename", filename.trim());

    if (emoji) params.set("emoji", "true");
    if (scv) params.set("skip_cert_verify", "true");
    if (udp) params.set("udp", "true");
    if (appendType) params.set("append_type", "true");
    if (sort) params.set("sort", "true");
    if (fdn) params.set("filter_deprecated", "true");
    if (expand) params.set("expand", "true");

    if (customParams.trim()) {
      const extra = customParams.trim().replace(/^\?/, "").replace(/^&/, "");
      for (const pair of extra.split("&")) {
        if (!pair) continue;
        const [k, v] = pair.split("=");
        if (!k) continue;
        const key = k.trim();
        const val = v !== undefined ? decodeURIComponent(v.trim()) : "";
        if (key && !params.has(key)) params.set(key, val);
      }
    }

    const link = `${base}/sub?${params.toString()}`;
    setOutput(link);
  }

  async function handleCopy() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleConfigChange(v: string) {
    setConfig(v);
    setShowCustomConfig(v === "custom");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">生成</h1>
        <p className="text-sm text-[rgb(0_0_0/44%)]">构建订阅链接，本地生成，无需短链服务。</p>
      </div>

      {/* 订阅源 */}
      <Card className="rounded-[8px] border shadow-none">
        <CardHeader>
          <CardTitle>订阅源</CardTitle>
          <CardDescription>订阅链接，每行一条，远程配置选择服务端预设。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="source">订阅链接</Label>
            <Textarea
              id="source"
              placeholder={"https://example.com/sub1\nhttps://example.com/sub2"}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="rounded-[8px] font-mono text-xs"
            />
            <p className="text-xs text-[rgb(0_0_0/44%)]">多链接用换行或 | 分隔，支持 data: 与 tag: 前缀。</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="remote-config">远程配置</Label>
            <Select
              id="remote-config"
              value={config}
              onChange={(e) => handleConfigChange(e.target.value)}
              aria-label="远程配置"
            >
              {REMOTE_CONFIGS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            {showCustomConfig ? (
              <Input
                placeholder="https://example.com/my.ini"
                value={customConfig}
                onChange={(e) => setCustomConfig(e.target.value)}
                className="rounded-[8px] font-mono text-xs"
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Target */}
      <Card className="rounded-[8px] border shadow-none">
        <CardHeader>
          <CardTitle>Target</CardTitle>
          <CardDescription>选择输出格式，高级选项默认收起。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="target">目标客户端</Label>
            <Select
              id="target"
              value={target}
              onChange={(e) => setTarget(e.target.value as typeof target)}
              aria-label="目标客户端"
            >
              {TARGETS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <p className="text-xs text-[rgb(0_0_0/44%)]">支持 13+ 格式：clash / surge / quanx / loon / surfboard / mixed / sssub / ss / ssd / singbox 等</p>
          </div>

          <Collapsible defaultOpen={false} className="rounded-[8px]">
            <CollapsibleTrigger>Advanced</CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="include" className="text-xs font-medium text-[rgb(0_0_0/64%)]">包含（正则）</Label>
                  <Input id="include" placeholder="HK|JP" value={include} onChange={(e) => setInclude(e.target.value)} className="rounded-[8px]" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="exclude" className="text-xs font-medium text-[rgb(0_0_0/64%)]">排除（正则）</Label>
                  <Input id="exclude" placeholder="x1|expired" value={exclude} onChange={(e) => setExclude(e.target.value)} className="rounded-[8px]" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="filename" className="text-xs font-medium text-[rgb(0_0_0/64%)]">文件名</Label>
                  <Input id="filename" placeholder="profile" value={filename} onChange={(e) => setFilename(e.target.value)} className="rounded-[8px]" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="custom-params" className="text-xs font-medium text-[rgb(0_0_0/64%)]">自定义参数</Label>
                  <Input
                    id="custom-params"
                    placeholder="rename=Group&interval=86400"
                    value={customParams}
                    onChange={(e) => setCustomParams(e.target.value)}
                    className="rounded-[8px] font-mono text-xs"
                  />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={emoji} onChange={(e) => setEmoji(e.target.checked)} />
                  Emoji
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={scv} onChange={(e) => setScv(e.target.checked)} />
                  SCV
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={udp} onChange={(e) => setUdp(e.target.checked)} />
                  UDP
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={appendType} onChange={(e) => setAppendType(e.target.checked)} />
                  Append type
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={sort} onChange={(e) => setSort(e.target.checked)} />
                  Sort
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={fdn} onChange={(e) => setFdn(e.target.checked)} />
                  FDN
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={expand} onChange={(e) => setExpand(e.target.checked)} />
                  Expand
                </label>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[rgb(0_0_0/44%)]">
                跳过证书验证 · 过滤废弃节点 · 展开规则集。
              </p>
            </CollapsibleContent>
          </Collapsible>

          <Button onClick={handleGenerate} className="rounded-[8px] bg-zinc-900 text-white hover:bg-zinc-800">
            生成链接
          </Button>
        </CardContent>
      </Card>

      {/* 输出 */}
      <Card className="rounded-[8px] border shadow-none">
        <CardHeader>
          <CardTitle>输出</CardTitle>
          <CardDescription>后端为 <code className="font-mono text-xs">{backendBase}</code> （管理前缀），复制生成的链接。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input readOnly value={output} placeholder="生成后显示链接" className="rounded-[8px] font-mono text-xs" />
            <Button variant="outline" onClick={handleCopy} disabled={!output} className="shrink-0 rounded-[8px]">
              {copied ? "已复制" : "复制"}
            </Button>
          </div>
          {output ? (
            <Collapsible defaultOpen={false} className="rounded-[8px]">
              <CollapsibleTrigger>预览</CollapsibleTrigger>
              <CollapsibleContent>
                <p className="break-all font-mono text-xs leading-relaxed text-[rgb(0_0_0/64%)]">{output}</p>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
