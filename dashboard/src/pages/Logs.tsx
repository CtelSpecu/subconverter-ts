import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectItem } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { getToken } from "@/lib/auth";

function authHeaders(): Record<string,string> {
  const t = getToken() || localStorage.getItem("dashboard_token") || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}
type LogRow = {
  time: number;
  ip: string;
  target: string;
  status: number;
  duration: number;
  url?: string;
  nodes?: number;
  cache?: string;
  [k:string]: any;
};

export default function LogsPage() {
  const [search, set搜索] = useState("");
  const [target, setTarget] = useState("all");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [retention, setRetention] = useState("180");
  const [retentionSaved, setRetentionSaved] = useState("180");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [selected, setSelected] = useState<LogRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function fetchLogs(p = page) {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (target !== "all") params.set("target", target);
      if (status !== "all") params.set("status", status);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      params.set("page", String(p));
      params.set("limit", String(limit));
      const res = await fetch(`/dashboard/api/logs?${params.toString()}`, { headers: authHeaders() });
      if (res.status===401) { window.location.href="/dashboard/auth"; return; }
      if (!res.ok) throw new Error(`请求失败 ${res.status}`);
      const data = await res.json() as { logs: LogRow[], total:number, retention:number };
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setTotal(Number(data.total||0));
      if (data.retention) { setRetention(String(data.retention)); setRetentionSaved(String(data.retention)); }
    } catch(e:any){ setError(e?.message||"失败"); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ fetchLogs(1); }, []);
  // refetch when filters change via button
  const filteredCount = total;
  const hasMore = page * limit < total;
  const nextPurgeAt = useMemo(() => {
    const days = Number(retention)||180;
    const d = new Date(Date.now() + days*86400000);
    return d.toISOString().slice(0,10);
  }, [retention]);

  async function handleExportCsv() {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (target !== "all") params.set("target", target);
      params.set("export","csv");
      const res = await fetch(`/dashboard/api/logs?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`请求失败 ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href=url; a.download="logs.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch(e:any){ setError(e?.message||"导出失败"); }
    finally { setBusy(false); }
  }
  async function handleRetentionSave() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/dashboard/api/logs/retention", { method:"POST", headers: { ...authHeaders(), "Content-Type":"application/json" }, body: JSON.stringify({ days: Number(retention) }) });
      const j = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error((j as any).error || `请求失败 ${res.status}`);
      setRetentionSaved(retention);
      await fetchLogs(page);
    } catch(e:any){ setError(e?.message||"保存失败"); }
    finally { setBusy(false); }
  }
  function openDetail(row: LogRow) { setSelected(row); setSheetOpen(true); }
  async function handleBlockIp(ip: string) {
    // add to ACL IP blacklist
    try {
      const res = await fetch("/dashboard/api/acl/ip", { method:"POST", headers: { ...authHeaders(), "Content-Type":"application/json" }, body: JSON.stringify({ value: ip, action: "add" }) });
      if (!res.ok) throw new Error(`请求失败 ${res.status}`);
      alert(`Blocked ${ip}`);
    } catch(e:any){ alert(e?.message||"封禁失败"); }
  }
  function statusVariant(s:number): "success"|"destructive"|"secondary" {
    if (s>=200 && s<300) return "success";
    if (s>=400) return "destructive";
    return "secondary";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">日志</h1>
          <p className="text-sm text-[rgb(0_0_0/44%)]">真实 D1 日志 — 支持搜索、筛选、保留与导出，共 {total}.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={()=>fetchLogs(page)} disabled={loading} className="rounded-[8px]">刷新</Button>
          <Button variant="outline" onClick={handleExportCsv} disabled={busy} className="rounded-[8px]">导出 CSV</Button>
        </div>
      </div>
      {error ? <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      <Card className="rounded-[8px] border shadow-none">
        <CardHeader><CardTitle className="text-sm">筛选</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input placeholder="搜索 IP 或目标" value={search} onChange={e=>set搜索(e.target.value)} className="rounded-[8px]" />
          <select value={target} onChange={e=>setTarget(e.target.value)} className="rounded-[8px] border px-2 py-2 text-sm">
            <option value="all">全部目标</option>
            <option value="clash">clash</option>
            <option value="surge">surge</option>
            <option value="quan">quan</option>
            <option value="loon">loon</option>
            <option value="mixed">mixed</option>
          </select>
          <select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-[8px] border px-2 py-2 text-sm">
            <option value="all">全部状态</option>
            <option value="200">200</option>
            <option value="400">400</option>
            <option value="500">500</option>
          </select>
          <Button onClick={()=>{ setPage(1); fetchLogs(1); }} className="rounded-[8px]">搜索</Button>
          <Input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="rounded-[8px]" />
          <Input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="rounded-[8px]" />
          <div className="flex gap-2">
            <select value={retention} onChange={e=>setRetention(e.target.value)} className="rounded-[8px] border px-2 py-2 text-sm flex-1">
              <option value="7">7d</option><option value="30">30d</option><option value="90">90d</option><option value="180">180d</option><option value="365">365d</option>
            </select>
            <Button variant="outline" onClick={handleRetentionSave} disabled={busy || retention===retentionSaved} className="rounded-[8px]">保存 {retention} {retention===retentionSaved?"✓":""}</Button>
          </div>
          <div className="text-xs text-[rgb(0_0_0/44%)]">下一页 purge {nextPurgeAt} — retention auto deletes older logs.</div>
        </CardContent>
      </Card>

      <Card className="rounded-[8px] border shadow-none">
        <CardContent className="p-0">
          {loading ? <div className="p-8 text-center text-sm text-[rgb(0_0_0/44%)]">加载中…</div> :
           logs.length===0 ? <div className="p-8 text-center text-sm text-[rgb(0_0_0/44%)]">暂无日志</div> :
           <Table>
             <TableHeader><TableRow><TableHead>时间</TableHead><TableHead>IP</TableHead><TableHead>目标</TableHead><TableHead>状态</TableHead><TableHead>耗时</TableHead><TableHead></TableHead></TableRow></TableHeader>
             <TableBody>
               {logs.map((row, idx)=>(
                 <TableRow key={idx}>
                   <TableCell className="text-xs font-mono">{row.time ? new Date(Number(row.time)).toLocaleString() : "—"}</TableCell>
                   <TableCell className="text-xs font-mono">{row.ip || "—"}</TableCell>
                   <TableCell className="text-xs">{row.target || "—"}</TableCell>
                   <TableCell><Badge variant={statusVariant(Number(row.status))}>{row.status}</Badge></TableCell>
                   <TableCell className="text-xs">{row.duration ?? "—"} ms</TableCell>
                   <TableCell className="flex gap-1">
                     <Button variant="ghost" size="sm" onClick={()=>openDetail(row)} className="h-7 text-xs">详情</Button>
                     {row.ip ? <Button variant="ghost" size="sm" onClick={()=>handleBlockIp(String(row.ip))} className="h-7 text-xs text-red-600">封禁 IP</Button> : null}
                   </TableCell>
                 </TableRow>
               ))}
             </TableBody>
           </Table>}
          <div className="flex items-center justify-between p-3 border-t">
            <div className="text-xs text-[rgb(0_0_0/44%)]">Page {page} — {filteredCount} total {hasMore?"(more)":""}</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page<=1} onClick={()=>{ const p=page-1; setPage(p); fetchLogs(p); }} className="rounded-[8px]">上一页</Button>
              <Button variant="outline" size="sm" disabled={!hasMore} onClick={()=>{ const p=page+1; setPage(p); fetchLogs(p); }} className="rounded-[8px]">下一页</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        {sheetOpen && selected ? <SheetContent className="w-[480px] max-w-[90vw] overflow-auto">
          <SheetHeader><SheetTitle>Log detail</SheetTitle><SheetDescription className="font-mono text-xs break-all">{JSON.stringify(selected, null, 2)}</SheetDescription></SheetHeader>
          <pre className="mt-4 rounded-[8px] bg-zinc-50 p-3 font-mono text-xs overflow-auto">{JSON.stringify(selected, null, 2)}</pre>
        </SheetContent> : null}
      </Sheet>
    </div>
  );
}
