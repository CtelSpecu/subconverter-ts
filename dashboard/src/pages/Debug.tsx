import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { getToken } from "@/lib/auth";

type ParseResult = {
  proxyJson: string;
  clash: string;
  surge: string;
};

async function tryParseLink(raw: string): Promise<ParseResult> {
  const input = raw.trim();
  if (!input) throw new Error("Enter a node link.");
  if (input.includes("\n")) throw new Error("Only one link is allowed. Remove line breaks.");
  const t = getToken() || localStorage.getItem("dashboard_token") || "";
  const headers: Record<string,string> = { "Content-Type":"application/json" };
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch("/dashboard/api/debug", { method:"POST", headers, body: JSON.stringify({ link: input }) });
  const j = await res.json().catch(()=>({})) as any;
  if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
  // backend returns {proxy, clash, surge}
  const proxyJson = JSON.stringify(j.proxy ?? j, null, 2);
  const clash = String(j.clash || "");
  const surge = String(j.surge || "");
  if (!proxyJson || proxyJson==="{}") throw new Error("No proxy parsed");
  return { proxyJson, clash, surge };
}

export default function DebugPage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clashOpen, setClashOpen] = useState(true);
  const [surgeOpen, setSurgeOpen] = useState(false);

  async function handleParse() {
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
      const parsed = await tryParseLink(raw);
      setResult(parsed);
    } catch (e:any) {
      setError(e?.message || String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Debug</h1>
        <p className="text-sm text-[rgb(0_0_0/44%)]">单链接解析预览。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>节点链接</CardTitle>
          <CardDescription>粘贴单条链接，预览代理 JSON、Clash/Surge。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea placeholder="ss://... or vmess://... (single link only)" value={input} onChange={(e) => setInput(e.target.value)} rows={4} />
          <div className="flex items-center gap-2">
            <Button onClick={handleParse}>Parse</Button>
            <Button variant="outline" onClick={() => { setInput(""); setResult(null); setError(null); }}>
              清空
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
