import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

type ParseResult = {
  proxyJson: string;
  clash: string;
  surge: string;
};

function tryParseLink(raw: string): ParseResult {
  const input = raw.trim();
  if (!input) throw new Error("Enter a node link.");
  if (input.includes("\n")) throw new Error("Only one link is allowed. Remove line breaks.");
  const scheme = input.split("://")[0]?.toLowerCase();
  const allowed = ["ss", "ssr", "vmess", "vless", "trojan", "hysteria", "hysteria2", "hy2", "tuic"];
  if (!scheme || !allowed.includes(scheme)) {
    throw new Error(`Unsupported scheme "${scheme ?? ""}". Allowed: ${allowed.join(", ")}`);
  }

  let proxy: Record<string, unknown> = {};
  try {
    if (scheme === "vmess") {
      const b64 = input.slice("vmess://".length).trim();
      const json = JSON.parse(atob(b64));
      proxy = {
        type: "vmess",
        server: json.add ?? json.address ?? "example.com",
        port: Number(json.port ?? 443),
        uuid: json.id ?? json.uuid ?? "***",
        alterId: json.aid ?? 0,
        cipher: json.scy ?? json.security ?? "auto",
        tls: json.tls === "tls",
        sni: json.sni ?? json.host ?? undefined,
        network: json.net ?? "tcp",
        wsPath: json.path ?? undefined,
        rawNote: json.ps ?? undefined,
      };
    } else if (scheme === "ss") {
      const hashIdx = input.indexOf("#");
      const withoutTag = hashIdx >= 0 ? input.slice(0, hashIdx) : input;
      const b64Part = withoutTag.slice("ss://".length).split("@").length > 1 ? withoutTag : `ss://${btoa(withoutTag.slice(5))}`;
      // Best-effort: extract host:port after @
      const atIdx = input.lastIndexOf("@");
      const hostPort = atIdx >= 0 ? input.slice(atIdx + 1).split("#")[0].split("?")[0].split("/")[0] : "example.com:8388";
      const [server, portStr] = hostPort.split(":");
      proxy = {
        type: "ss",
        server: server || "example.com",
        port: Number(portStr || 8388),
        method: "aes-256-gcm",
        password: "***",
        tag: hashIdx >= 0 ? decodeURIComponent(input.slice(hashIdx + 1)) : undefined,
        _note: b64Part ? undefined : undefined,
      };
    } else {
      // Generic for trojan/vless/hysteria etc: parse authority
      const url = new URL(input.replace(/^hy2:/, "https:").replace(/^hysteria2:/, "https:").replace(/^tuic:/, "https:"));
      proxy = {
        type: scheme,
        server: url.hostname || "example.com",
        port: Number(url.port || 443),
        password: "***",
        sni: url.searchParams.get("sni") ?? url.searchParams.get("peer") ?? undefined,
        alpn: url.searchParams.get("alpn") ?? undefined,
        tag: url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined,
      };
    }
  } catch (e) {
    // Fallback generic
    if (Object.keys(proxy).length === 0) {
      const fallbackUrl = (() => {
        try {
          return new URL(input.replace(/^[a-z0-9]+:\/\//i, "https://"));
        } catch {
          return null;
        }
      })();
      proxy = {
        type: scheme ?? "unknown",
        server: fallbackUrl?.hostname ?? "example.com",
        port: fallbackUrl?.port ? Number(fallbackUrl.port) : 443,
        password: "***",
        _warning: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const proxyJson = JSON.stringify(proxy, null, 2);
  const clash =
    scheme === "ss"
      ? `- {name: ${JSON.stringify(String(proxy.tag ?? "ss-node"))}, type: ss, server: ${proxy.server}, port: ${proxy.port}, cipher: ${proxy.method ?? "aes-256-gcm"}, password: "***"}`
      : `- {name: ${JSON.stringify(String(proxy.tag ?? `${scheme}-node`))}, type: ${proxy.type}, server: ${proxy.server}, port: ${proxy.port}}`;
  const surge =
    scheme === "ss"
      ? `${String(proxy.tag ?? "ss-node")} = ss, ${proxy.server}, ${proxy.port}, encrypt-method=${proxy.method ?? "aes-256-gcm"}, password=***`
      : `${String(proxy.tag ?? `${scheme}-node`)} = ${scheme}, ${proxy.server}, ${proxy.port}, password=***`;

  return { proxyJson, clash, surge };
}

export default function DebugPage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clashOpen, setClashOpen] = useState(true);
  const [surgeOpen, setSurgeOpen] = useState(false);

  function handleParse() {
    setError(null);
    setResult(null);
    const raw = input.trim();
    if (!raw) {
      setError("Enter a node link.");
      return;
    }
    if (raw.split("\n").filter((l) => l.trim()).length > 1) {
      setError("Only one link is allowed. Paste a single ss:// / vmess:// / vless:// / trojan:// link.");
      return;
    }
    try {
      const parsed = tryParseLink(raw);
      setResult(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Debug</h1>
        <p className="text-sm text-[rgb(0_0_0/44%)]">Single link parse preview.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Node link</CardTitle>
          <CardDescription>Paste one link, preview proxy JSON, Clash/Surge.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea placeholder="ss://... or vmess://... (single link only)" value={input} onChange={(e) => setInput(e.target.value)} rows={4} />
          <div className="flex items-center gap-2">
            <Button onClick={handleParse}>Parse</Button>
            <Button variant="outline" onClick={() => { setInput(""); setResult(null); setError(null); }}>
              Clear
            </Button>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Parse error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {result ? (
            <div className="space-y-3">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs">Proxy JSON</CardTitle>
                  <CardDescription>Normalized proxy object. Secrets are masked.</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-auto rounded-[8px] border bg-zinc-50 p-4 font-mono text-xs leading-relaxed">{result.proxyJson}</pre>
                </CardContent>
              </Card>

              <Collapsible open={clashOpen} onOpenChange={setClashOpen}>
                <Card>
                  <CardHeader className="pb-2">
                    <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
                      <span className="text-xs font-semibold">Clash preview</span>
                      <ChevronDown className={`h-4 w-4 text-[rgb(0_0_0/44%)] transition-transform ${clashOpen ? "rotate-180" : ""}`} />
                    </CollapsibleTrigger>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent>
                      <pre className="overflow-auto rounded-[8px] border bg-zinc-50 p-4 font-mono text-xs leading-relaxed">{result.clash}</pre>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              <Collapsible open={surgeOpen} onOpenChange={setSurgeOpen}>
                <Card>
                  <CardHeader className="pb-2">
                    <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
                      <span className="text-xs font-semibold">Surge preview</span>
                      <ChevronDown className={`h-4 w-4 text-[rgb(0_0_0/44%)] transition-transform ${surgeOpen ? "rotate-180" : ""}`} />
                    </CollapsibleTrigger>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent>
                      <pre className="overflow-auto rounded-[8px] border bg-zinc-50 p-4 font-mono text-xs leading-relaxed">{result.surge}</pre>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
