import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

const chartData = [
  { t: "00:00", v: 42 },
  { t: "04:00", v: 38 },
  { t: "08:00", v: 65 },
  { t: "12:00", v: 58 },
  { t: "16:00", v: 72 },
  { t: "20:00", v: 48 },
  { t: "24:00", v: 41 },
];

const defaults = {
  perIpRpm: 30,
  perIpBurst: 10,
  perDomainConcurrency: 4,
  perDomainTimeout: 8000,
  globalRps: 120,
};

export default function LimitsPage() {
  const [perIpRpm, setPerIpRpm] = useState(defaults.perIpRpm);
  const [perIpBurst, setPerIpBurst] = useState(defaults.perIpBurst);
  const [perDomainConcurrency, setPerDomainConcurrency] = useState(defaults.perDomainConcurrency);
  const [perDomainTimeout, setPerDomainTimeout] = useState(defaults.perDomainTimeout);
  const [globalRps, setGlobalRps] = useState(defaults.globalRps);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  const handleReset = () => {
    setPerIpRpm(defaults.perIpRpm);
    setPerIpBurst(defaults.perIpBurst);
    setPerDomainConcurrency(defaults.perDomainConcurrency);
    setPerDomainTimeout(defaults.perDomainTimeout);
    setGlobalRps(defaults.globalRps);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold leading-none">Limits</h1>
        <p className="mt-1 text-sm text-[rgb(0_0_0/44%)]">Rate limiting and circuit breaking. Changes persist to KV.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Per-IP</CardTitle>
            <CardDescription>Requests per minute and burst allowance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">RPM</label>
              <Input type="number" min={1} value={perIpRpm} onChange={(e) => setPerIpRpm(Number(e.target.value))} />
              <p className="text-xs text-[rgb(0_0_0/44%)]">Max requests per minute per IP</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Burst</label>
              <Input type="number" min={1} value={perIpBurst} onChange={(e) => setPerIpBurst(Number(e.target.value))} />
              <p className="text-xs text-[rgb(0_0_0/44%)]">Short burst allowance</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Per-Domain</CardTitle>
            <CardDescription>Concurrency and upstream timeout</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Concurrency</label>
              <Input type="number" min={1} value={perDomainConcurrency} onChange={(e) => setPerDomainConcurrency(Number(e.target.value))} />
              <p className="text-xs text-[rgb(0_0_0/44%)]">Max parallel fetches per domain</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Timeout (ms)</label>
              <Input type="number" min={100} step={100} value={perDomainTimeout} onChange={(e) => setPerDomainTimeout(Number(e.target.value))} />
              <p className="text-xs text-[rgb(0_0_0/44%)]">Upstream fetch timeout</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Global</CardTitle>
            <CardDescription>Overall throughput cap</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">RPS</label>
              <Input type="number" min={1} value={globalRps} onChange={(e) => setGlobalRps(Number(e.target.value))} />
              <p className="text-xs text-[rgb(0_0_0/44%)]">Global requests per second</p>
            </div>
            <div className="rounded-[8px] border bg-zinc-50 px-3 py-2">
              <p className="text-xs text-[rgb(0_0_0/44%)]">Effective cap is the tightest of per-IP, per-domain, and global.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Throughput</CardTitle>
          <CardDescription>Neutral placeholder — replace with live metrics when available</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[160px] w-full rounded-[8px] border bg-white p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "rgb(0 0 0 / 44%)" }} axisLine={{ stroke: "rgb(0 0 0 / 10%)" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "rgb(0 0 0 / 44%)" }} axisLine={false} tickLine={false} width={32} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid rgb(0 0 0 / 10%)", fontSize: 12 }}
                />
                <Line type="monotone" dataKey="v" stroke="#18181b" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-[rgb(0_0_0/44%)]">Requests per minute (sample). No color fill, single zinc stroke.</p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={handleSave}>{saved ? "Saved" : "Save"}</Button>
        <Button variant="outline" onClick={handleReset}>Reset</Button>
        {saved && <span className="text-xs text-[rgb(0_0_0/44%)]">Saved to local state. Wire to /dashboard/api/limits.</span>}
      </div>
    </div>
  );
}
