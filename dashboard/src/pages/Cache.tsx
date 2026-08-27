import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { getToken } from "@/lib/auth";

function authHeaders(): Record<string,string> {
  const t = getToken() || localStorage.getItem("dashboard_token") || "";
  return t ? { Authorization: `Bearer ${t}`, "Content-Type":"application/json" } : { "Content-Type":"application/json" };
}

export default function CachePage() {
  const [stats, setStats] = useState<{hitRate:number|null, entries:number, rulesets:number}|null>(null);
  const [timestamp, setTimestamp] = useState<number|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [flushOpen, setFlushOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function fetchStats() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/dashboard/api/cache", { headers: authHeaders() });
      if (res.status===401) { window.location.href="/dashboard/auth"; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { stats: {hitRate:number|null, entries:number, rulesets:number}, timestamp:number };
      setStats(data.stats || { hitRate:null, entries:0, rulesets:0 });
      setTimestamp(data.timestamp || Date.now());
    } catch(e:any){ setError(e?.message||"Failed"); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ fetchStats(); }, []);

  async function handleFlush() {
    setBusy(true); setStatus(null);
    try {
      const res = await fetch("/dashboard/api/cache/flush", { method:"POST", headers: authHeaders() });
      const body = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
      setStatus("Flushed");
      await fetchStats();
    } catch(e:any){ setStatus(e?.message||"清空 failed"); }
    finally { setBusy(false); setFlushOpen(false); }
  }
  async function handleRefresh() {
    setBusy(true); setStatus(null);
    try {
      const res = await fetch("/dashboard/api/cache/refresh", { method:"POST", headers: authHeaders() });
      const body = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
      setStatus("Refreshed");
      await fetchStats();
    } catch(e:any){ setStatus(e?.message||"刷新 failed"); }
    finally { setBusy(false); setRefreshOpen(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Cache</h1>
        <p className="text-sm text-[rgb(0_0_0/44%)]">内存 + KV 统计，来自真实接口。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-[8px] border shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">条目</CardTitle></CardHeader>
          <CardContent>
            {loading ? <div className="text-sm text-[rgb(0_0_0/44%)]">Loading…</div> : error ? <div className="text-sm text-red-600">{error}</div> : <div className="text-2xl font-semibold">{stats?.entries ?? 0}</div>}
            <p className="text-xs text-[rgb(0_0_0/44%)] mt-1">KV CACHE keys (0–1000 sampled)</p>
          </CardContent>
        </Card>
        <Card className="rounded-[8px] border shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">命中率</CardTitle></CardHeader>
          <CardContent>
            {loading ? <div className="text-sm text-[rgb(0_0_0/44%)]">—</div> : <div className="text-2xl font-semibold">{stats?.hitRate==null ? "—" : `${stats.hitRate}%`}</div>}
            <p className="text-xs text-[rgb(0_0_0/44%)] mt-1">Not tracked (in-memory Map)</p>
          </CardContent>
        </Card>
        <Card className="rounded-[8px] border shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">规则集</CardTitle></CardHeader>
          <CardContent>
            {loading ? <div className="text-sm text-[rgb(0_0_0/44%)]">—</div> : <div className="text-2xl font-semibold">{stats?.rulesets ?? 0}</div>}
            <p className="text-xs text-[rgb(0_0_0/44%)] mt-1">Cached remote configs</p>
          </CardContent>
        </Card>
      </div>

      {status ? <div className="rounded-[8px] border bg-zinc-50 px-3 py-2 text-sm">{status} {timestamp ? `— ${new Date(timestamp).toLocaleString()}` : ""}</div> : null}
      {timestamp && !status ? <div className="text-xs text-[rgb(0_0_0/44%)]">Updated {new Date(timestamp).toLocaleString()}</div> : null}

      <Card className="rounded-[8px] border shadow-none">
        <CardHeader>
          <CardTitle>操作</CardTitle>
          <CardDescription>清空 clears in-memory and up to 1000 KV keys. 刷新 re-warms.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant="outline" onClick={()=>setFlushOpen(true)} disabled={busy} className="rounded-[8px]">清空</Button>
          <Button onClick={()=>setRefreshOpen(true)} disabled={busy} className="rounded-[8px] bg-zinc-900 text-white hover:bg-zinc-800">刷新</Button>
          <Button variant="ghost" onClick={fetchStats} disabled={loading} className="rounded-[8px]">刷新</Button>
        </CardContent>
      </Card>

      <Card className="rounded-[8px] border shadow-none">
        <CardHeader>
          <CardTitle>规则集</CardTitle>
          <CardDescription>Currently no per-ruleset breakdown; backend reports totals.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>URL</TableHead><TableHead>Count</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader>
            <TableBody><TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-[rgb(0_0_0/44%)]">No breakdown — see /dashboard/api/cache for totals.</TableCell></TableRow></TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={flushOpen} onOpenChange={setFlushOpen}>
        <AlertDialogContent className="rounded-[8px]">
          <AlertDialogHeader><AlertDialogTitle>清空 cache?</AlertDialogTitle><AlertDialogDescription> Clears in-memory and up to 1000 KV entries.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="rounded-[8px]">取消</AlertDialogCancel><AlertDialogAction onClick={handleFlush} className="rounded-[8px] bg-red-600 hover:bg-red-700">清空</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={refreshOpen} onOpenChange={setRefreshOpen}>
        <AlertDialogContent className="rounded-[8px]">
          <AlertDialogHeader><AlertDialogTitle>刷新 cache?</AlertDialogTitle><AlertDialogDescription> 清空 then re-warm.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="rounded-[8px]">取消</AlertDialogCancel><AlertDialogAction onClick={handleRefresh} className="rounded-[8px]">刷新</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
