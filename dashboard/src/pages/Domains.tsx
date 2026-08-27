import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getToken } from "@/lib/auth";

type AllowEntry = { domain: string; remark: string; addedAt: string };

function formatDate(ts: number | string) {
  try {
    const d = new Date(typeof ts === "number" ? ts : String(ts));
    if (isNaN(d.getTime())) return String(ts).slice(0,10);
    return d.toISOString().slice(0,10);
  } catch { return String(ts).slice(0,10); }
}
function authHeaders(): Record<string,string> {
  const t = getToken() || localStorage.getItem("dashboard_token") || localStorage.getItem("auth_token") || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function DomainsPage() {
  const [managedPrefix, setManagedPrefix] = useState("");
  const [allowlist, setAllowlist] = useState<AllowEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [remarkInput, setRemarkInput] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AllowEntry | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string|null>(null);

  async function fetchDomains() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/dashboard/api/domains", { headers: authHeaders() });
      if (res.status === 401) { window.location.href = "/dashboard/auth"; return; }
      if (!res.ok) throw new Error(`请求失败 ${res.status}`);
      const data = await res.json() as { domains: AllowEntry[]; managedPrefix: string };
      setAllowlist(Array.isArray(data.domains) ? data.domains : []);
      if (data.managedPrefix) setManagedPrefix(String(data.managedPrefix));
    } catch (e:any) { setError(e?.message || "获取失败"); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ fetchDomains(); }, []);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(managedPrefix || ""); setCopied(true); setTimeout(()=>setCopied(false),1200); } catch {}
  };
  const handleAdd = async () => {
    const v = domainInput.trim().toLowerCase();
    if (!v || !confirmChecked) return;
    setActionError(null);
    try {
      const res = await fetch("/dashboard/api/domains", { method: "POST", headers: { ...authHeaders(), "Content-Type":"application/json" }, body: JSON.stringify({ domain: v, remark: remarkInput.trim() }) });
      const body = await res.json().catch(()=>({}));
      if (!res.ok) { setActionError((body as any).error || `添加失败 ${res.status}`); return; }
      setDomainInput(""); setRemarkInput(""); setConfirmChecked(false); setAddOpen(false);
      await fetchDomains();
    } catch (e:any){ setActionError(e?.message||"添加失败"); }
  };
  const handleDelete = async () => {
    if (!deleteTarget || !deleteConfirm) return;
    setActionError(null);
    try {
      const res = await fetch(`/dashboard/api/domains/${encodeURIComponent(deleteTarget.domain)}`, { method: "DELETE", headers: authHeaders() });
      const body = await res.json().catch(()=>({}));
      if (!res.ok) { setActionError((body as any).error || `删除失败 ${res.status}`); return; }
      setDeleteTarget(null); setDeleteConfirm(false);
      await fetchDomains();
    } catch (e:any){ setActionError(e?.message||"删除失败"); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Domains</h1>
          <p className="text-sm text-[rgb(0_0_0/44%)]">前端白名单与管理前缀，真实 KV 数据。</p>
        </div>
        <Button onClick={()=>setAddOpen(true)} className="rounded-[8px]">添加域名</Button>
      </div>

      <Card className="rounded-[8px] border shadow-none">
        <CardHeader>
          <CardTitle>管理前缀</CardTitle>
          <CardDescription>生成页使用的后端，来自环境变量 MANAGED_PREFIX。</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input readOnly value={managedPrefix} placeholder={loading?"Loading…":"—"} className="rounded-[8px] font-mono text-xs" />
          <Button variant="outline" onClick={handleCopy} className="shrink-0 rounded-[8px]">{copied?"已复制":"复制"}</Button>
        </CardContent>
      </Card>

      <Card className="rounded-[8px] border shadow-none">
        <CardHeader>
          <CardTitle>白名单</CardTitle>
          <CardDescription>{loading?"Loading…":`${allowlist.length} entries — empty allowlist means open (*). Non-empty enforces CORS + API check`}</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? <div className="mb-3 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          {actionError ? <div className="mb-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">{actionError}</div> : null}
          {loading ? <div className="rounded-[8px] border bg-zinc-50 p-8 text-center text-sm text-[rgb(0_0_0/44%)]">Loading…</div> :
          allowlist.length===0 ? <div className="rounded-[8px] border bg-zinc-50 p-8 text-center text-sm text-[rgb(0_0_0/44%)]">No domains yet. 添加 one to restrict.</div> :
          <Table>
            <TableHeader><TableRow><TableHead>Domain</TableHead><TableHead>Remark</TableHead><TableHead>Added</TableHead><TableHead className="w-[80px]"></TableHead></TableRow></TableHeader>
            <TableBody>
              {allowlist.map(e=>(
                <TableRow key={e.domain}>
                  <TableCell className="font-mono text-xs">{e.domain}</TableCell>
                  <TableCell className="text-xs text-[rgb(0_0_0/64%)]">{e.remark||"—"}</TableCell>
                  <TableCell className="text-xs">{formatDate(e.addedAt)}</TableCell>
                  <TableCell><Button variant="ghost" size="sm" onClick={()=>{setDeleteTarget(e); setDeleteConfirm(false);}} className="h-7 text-xs text-red-600 hover:bg-red-50">删除</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        {addOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={()=>setAddOpen(false)}>
          <div className="w-full max-w-md rounded-[8px] bg-white p-6 shadow-lg" onClick={e=>e.stopPropagation()}>
            <DialogHeader><DialogTitle>添加域名</DialogTitle><DialogDescription>域名将写入 KV 白名单。</DialogDescription></DialogHeader>
            <div className="mt-4 space-y-3">
              <Input placeholder="sub.ctelspecu.hxcn.top" value={domainInput} onChange={e=>setDomainInput(e.target.value)} className="rounded-[8px] font-mono text-xs" />
              <Input placeholder="remark (optional)" value={remarkInput} onChange={e=>setRemarkInput(e.target.value)} className="rounded-[8px] text-xs" />
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={confirmChecked} onChange={e=>setConfirmChecked(e.target.checked)} /> I confirm</label>
            </div>
            <DialogFooter><Button variant="outline" onClick={()=>setAddOpen(false)} className="rounded-[8px]">取消</Button><Button onClick={handleAdd} disabled={!domainInput.trim()||!confirmChecked} className="rounded-[8px]">添加</Button></DialogFooter>
          </div>
        </div> : null}
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o)=>{ if(!o){setDeleteTarget(null); setDeleteConfirm(false);} }}>
        {deleteTarget ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={()=>{setDeleteTarget(null); setDeleteConfirm(false);}}>
          <div className="w-full max-w-md rounded-[8px] bg-white p-6 shadow-lg" onClick={e=>e.stopPropagation()}>
            <DialogHeader><DialogTitle>删除 {deleteTarget.domain}?</DialogTitle><DialogDescription>This will remove the domain from allowlist.</DialogDescription></DialogHeader>
            <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.checked)} /> Confirm delete</label>
            <DialogFooter><Button variant="outline" onClick={()=>{setDeleteTarget(null); setDeleteConfirm(false);}} className="rounded-[8px]">取消</Button><Button variant="destructive" onClick={handleDelete} disabled={!deleteConfirm} className="rounded-[8px]">删除</Button></DialogFooter>
          </div>
        </div> : null}
      </Dialog>
    </div>
  );
}
