import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { getToken } from "@/lib/auth";

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
  perIpRpm: 60,
  perIpBurst: 120,
  perDomainConcurrency: 5,
  perDomainTimeout: 5000,
  globalRps: 100,
};
function authHeaders(): Record<string,string> {
  const t = getToken() || localStorage.getItem("dashboard_token") || "";
  return t ? { Authorization: `Bearer ${t}`, "Content-Type":"application/json" } : { "Content-Type":"application/json" };
}

export default function LimitsPage() {
  const [perIpRpm, setPerIpRpm] = useState(defaults.perIpRpm);
  const [perIpBurst, setPerIpBurst] = useState(defaults.perIpBurst);
  const [perDomainConcurrency, setPerDomainConcurrency] = useState(defaults.perDomainConcurrency);
  const [perDomainTimeout, setPerDomainTimeout] = useState(defaults.perDomainTimeout);
  const [globalRps, setGlobalRps] = useState(defaults.globalRps);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function fetchLimits() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/dashboard/api/limits", { headers: authHeaders() });
      if (res.status===401) { window.location.href="/dashboard/auth"; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { limits: { perIp:{rpm:number, burst:number}, perDomain:{concurrency:number, timeout:number}, global:{rps:number} } };
      const l = data.limits;
      if (l?.perIp) { if (l.perIp.rpm!=null) setPerIpRpm(Number(l.perIp.rpm)); if (l.perIp.burst!=null) setPerIpBurst(Number(l.perIp.burst)); }
      if (l?.perDomain) { if (l.perDomain.concurrency!=null) setPerDomainConcurrency(Number(l.perDomain.concurrency)); if (l.perDomain.timeout!=null) setPerDomainTimeout(Number(l.perDomain.timeout)); }
      if (l?.global?.rps!=null) setGlobalRps(Number(l.global.rps));
    } catch(e:any){ setError(e?.message||"Failed"); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ fetchLimits(); }, []);

  const handleSave = async () => {
    setSaving(true); setError(null); setSaved(false);
    try {
      const payload = { limits: { perIp: { rpm: perIpRpm, burst: perIpBurst }, perDomain: { concurrency: perDomainConcurrency, timeout: perDomainTimeout }, global: { rps: globalRps } } };
      const res = await fetch("/dashboard/api/limits", { method:"PUT", headers: authHeaders(), body: JSON.stringify(payload) });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error((j as any).error || `HTTP ${res.status}`);
      setSaved(true); setTimeout(()=>setSaved(false),1800);
    } catch(e:any){ setError(e?.message||"Save failed"); }
    finally { setSaving(false); }
  };
  const handleReset = async () => {
    setPerIpRpm(defaults.perIpRpm);
    setPerIpBurst(defaults.perIpBurst);
    setPerDomainConcurrency(defaults.perDomainConcurrency);
    setPerDomainTimeout(defaults.perDomainTimeout);
    setGlobalRps(defaults.globalRps);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Limits</h1>
        <p className="text-sm text-[rgb(0_0_0/44%)]">{loading?"Loading…":"Real KV limits. Global + per-IP + per-domain."}</p>
      </div>
      {error ? <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {saved ? <div className="rounded-[8px] border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Saved to KV ADMIN:limits</div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-[8px] border shadow-none">
          <CardHeader><CardTitle className="text-sm">Per-IP</CardTitle><CardDescription>RPM / burst</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><label className="text-xs">RPM</label><Input type="number" value={perIpRpm} onChange={e=>setPerIpRpm(Number(e.target.value))} className="rounded-[8px] mt-1" /></div>
            <div><label className="text-xs">Burst</label><Input type="number" value={perIpBurst} onChange={e=>setPerIpBurst(Number(e.target.value))} className="rounded-[8px] mt-1" /></div>
          </CardContent>
        </Card>
        <Card className="rounded-[8px] border shadow-none">
          <CardHeader><CardTitle className="text-sm">Per-Domain</CardTitle><CardDescription>Concurrency / timeout</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><label className="text-xs">Concurrency</label><Input type="number" value={perDomainConcurrency} onChange={e=>setPerDomainConcurrency(Number(e.target.value))} className="rounded-[8px] mt-1" /></div>
            <div><label className="text-xs">Timeout ms</label><Input type="number" value={perDomainTimeout} onChange={e=>setPerDomainTimeout(Number(e.target.value))} className="rounded-[8px] mt-1" /></div>
          </CardContent>
        </Card>
        <Card className="rounded-[8px] border shadow-none">
          <CardHeader><CardTitle className="text-sm">Global</CardTitle><CardDescription>RPS</CardDescription></CardHeader>
          <CardContent>
            <div><label className="text-xs">RPS</label><Input type="number" value={globalRps} onChange={e=>setGlobalRps(Number(e.target.value))} className="rounded-[8px] mt-1" /></div>
            <div className="mt-4 h-[60px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><XAxis dataKey="t" hide /><YAxis hide /><Tooltip /><Line type="monotone" dataKey="v" stroke="#111" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-[8px] border shadow-none">
        <CardHeader><CardTitle className="text-sm">Raw</CardTitle></CardHeader>
        <CardContent><pre className="rounded-[8px] bg-zinc-50 p-3 font-mono text-xs">{JSON.stringify({ perIp:{rpm:perIpRpm,burst:perIpBurst}, perDomain:{concurrency:perDomainConcurrency,timeout:perDomainTimeout}, global:{rps:globalRps}}, null, 2)}</pre></CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving} className="rounded-[8px] bg-zinc-900 text-white hover:bg-zinc-800">{saving?"Saving…":"Save"}</Button>
        <Button variant="outline" onClick={handleReset} className="rounded-[8px]">Reset to defaults</Button>
        <Button variant="ghost" onClick={fetchLimits} disabled={loading} className="rounded-[8px]">Reload</Button>
      </div>
    </div>
  );
}
