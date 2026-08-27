import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getToken } from "@/lib/auth";

type AclEntryRaw = string;
type TabKey = "ip" | "domain" | "ua" | "remark";
function authHeaders(): Record<string,string> {
  const t = getToken() || localStorage.getItem("dashboard_token") || "";
  return t ? { Authorization: `Bearer ${t}`, "Content-Type":"application/json" } : { "Content-Type":"application/json" };
}

export default function AclPage() {
  const [enableBlacklist, setEnableBlacklist] = useState(false);
  const [enableWhitelist, setEnableWhitelist] = useState(false);
  const [active, setActive] = useState<TabKey>("ip");
  const [data, setData] = useState<Record<TabKey, string[]>>({ ip:[], domain:[], ua:[], remark:[] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<string|null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [dialogTab, setDialogTab] = useState<TabKey>("ip");
  const [busy, setBusy] = useState(false);

  async function fetchAcl() {
    setLoading(true); setError(null);
    try {
      const h = authHeaders();
      const res = await fetch("/dashboard/api/acl", { headers: h });
      if (res.status===401) { window.location.href="/dashboard/auth"; return; }
      if (!res.ok) throw new Error(`请求失败 ${res.status}`);
      const j = await res.json() as { blackEnabled:boolean, whiteEnabled:boolean };
      setEnableBlacklist(!!j.blackEnabled);
      setEnableWhitelist(!!j.whiteEnabled);
      // fetch each type
      const types: TabKey[] = ["ip","domain","ua","remark"];
      const next: Record<TabKey, string[]> = { ip:[], domain:[], ua:[], remark:[] };
      for (const t of types) {
        const r = await fetch(`/dashboard/api/acl/${t}`, { headers: h });
        if (r.ok) {
          const dj = await r.json() as { entries: unknown[] };
          const arr = Array.isArray(dj.entries) ? dj.entries.map(v=> String(v)) : [];
          next[t]=arr;
        }
      }
      setData(next);
    } catch(e:any){ setError(e?.message||"失败"); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ fetchAcl(); }, []);

  async function toggleBlack(v:boolean) {
    setBusy(true);
    try {
      const res = await fetch("/dashboard/api/acl", { method:"POST", headers: authHeaders(), body: JSON.stringify({ enableBlack: v }) });
      if (!res.ok) throw new Error(`请求失败 ${res.status}`);
      setEnableBlacklist(v);
    } catch(e:any){ setError(e?.message||"切换失败"); }
    finally { setBusy(false); }
  }
  async function toggleWhite(v:boolean) {
    setBusy(true);
    try {
      const res = await fetch("/dashboard/api/acl", { method:"POST", headers: authHeaders(), body: JSON.stringify({ enableWhite: v }) });
      if (!res.ok) throw new Error(`请求失败 ${res.status}`);
      setEnableWhitelist(v);
    } catch(e:any){ setError(e?.message||"切换失败"); }
    finally { setBusy(false); }
  }

  const openAdd = (tab: TabKey) => { setDialogTab(tab); setEditing(null); setDraftValue(""); setDraftNote(""); setDialogOpen(true); };
  const openEdit = (tab: TabKey, entry: string) => { setDialogTab(tab); setEditing(entry); setDraftValue(entry); setDraftNote(""); setDialogOpen(true); };
  const handleSave = async () => {
    const v = draftValue.trim();
    if (!v) return;
    setBusy(true);
    try {
      if (editing) {
        // replace: delete old, add new if changed
        if (editing !== v) {
          await fetch(`/dashboard/api/acl/${dialogTab}`, { method:"POST", headers: authHeaders(), body: JSON.stringify({ value: editing, action: "remove" }) });
          const res = await fetch(`/dashboard/api/acl/${dialogTab}`, { method:"POST", headers: authHeaders(), body: JSON.stringify({ value: v, action: "add" }) });
          const j = await res.json().catch(()=>({}));
          if (!res.ok) throw new Error((j as any).error || `请求失败 ${res.status}`);
        }
      } else {
        const res = await fetch(`/dashboard/api/acl/${dialogTab}`, { method:"POST", headers: authHeaders(), body: JSON.stringify({ value: v, action: "add" }) });
        const j = await res.json().catch(()=>({}));
        if (!res.ok) throw new Error((j as any).error || `请求失败 ${res.status}`);
      }
      setDialogOpen(false);
      await fetchAcl();
    } catch(e:any){ setError(e?.message||"保存失败"); }
    finally { setBusy(false); }
  };
  const handleDelete = async (tab: TabKey, value: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/dashboard/api/acl/${tab}`, { method:"POST", headers: authHeaders(), body: JSON.stringify({ value, action: "remove" }) });
      if (!res.ok) throw new Error(`请求失败 ${res.status}`);
      await fetchAcl();
    } catch(e:any){ setError(e?.message||"删除失败"); }
    finally { setBusy(false); }
  };

  const renderTable = (tab: TabKey, label: string) => (
    <Card className="rounded-[8px] border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="text-sm">{label}</CardTitle><CardDescription className="text-xs">{data[tab].length} entries</CardDescription></div>
        <Button size="sm" onClick={()=>openAdd(tab)} className="rounded-[8px] h-7 text-xs">添加</Button>
      </CardHeader>
      <CardContent>
        {loading ? <div className="py-8 text-center text-sm text-[rgb(0_0_0/44%)]">Loading…</div> :
         data[tab].length===0 ? <div className="py-8 text-center text-sm text-[rgb(0_0_0/44%)]">No entries. 添加 one.</div> :
         <Table>
           <TableHeader><TableRow><TableHead>Value</TableHead><TableHead className="w-[100px]"></TableHead></TableRow></TableHeader>
           <TableBody>
             {data[tab].map((val)=>(
               <TableRow key={val}>
                 <TableCell className="font-mono text-xs break-all">{val}</TableCell>
                 <TableCell className="flex gap-1">
                   <Button variant="ghost" size="sm" onClick={()=>openEdit(tab, val)} className="h-7 text-xs">编辑</Button>
                   <Button variant="ghost" size="sm" onClick={()=>handleDelete(tab, val)} disabled={busy} className="h-7 text-xs text-red-600 hover:bg-red-50">删除</Button>
                 </TableCell>
               </TableRow>
             ))}
           </TableBody>
         </Table>}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">ACL</h1>
        <p className="text-sm text-[rgb(0_0_0/44%)]">真实 KV 数据，黑白名单开关控制过滤。</p>
      </div>
      {error ? <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      <Card className="rounded-[8px] border shadow-none">
        <CardContent className="flex gap-6 py-4">
          <label className="flex items-center gap-2 text-sm"><Switch checked={enableBlacklist} onCheckedChange={toggleBlack} disabled={busy} /> 黑名单 {enableBlacklist?"on":"off"}</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={enableWhitelist} onCheckedChange={toggleWhite} disabled={busy} /> 白名单 {enableWhitelist?"on":"off"}</label>
          <Button variant="ghost" size="sm" onClick={fetchAcl} disabled={loading} className="ml-auto rounded-[8px]">刷新</Button>
        </CardContent>
      </Card>

      <Tabs value={active} onValueChange={(v)=>setActive(v as TabKey)}>
        <TabsList className="rounded-[8px]">
          <TabsTrigger value="ip">IP</TabsTrigger>
          <TabsTrigger value="domain">域名</TabsTrigger>
          <TabsTrigger value="ua">用户代理</TabsTrigger>
          <TabsTrigger value="remark">备注</TabsTrigger>
        </TabsList>
        <TabsContent value="ip" className="mt-4">{renderTable("ip","IP 黑白名单")}</TabsContent>
        <TabsContent value="ua" className="mt-4">{renderTable("ua","用户代理 正则")}</TabsContent>
        <TabsContent value="remark" className="mt-4">{renderTable("remark","备注过滤")}</TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {dialogOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={()=>setDialogOpen(false)}>
          <div className="w-full max-w-md rounded-[8px] bg-white p-6 shadow-lg" onClick={e=>e.stopPropagation()}>
            <DialogHeader><DialogTitle>{editing?"编辑":"添加"} {dialogTab}</DialogTitle><DialogDescription>{editing ? `正在编辑 ${editing}` : `添加新的 ${dialogTab} 条目`}</DialogDescription></DialogHeader>
            <div className="mt-4 space-y-3">
              <Input placeholder="值（IP、域名、正则…）" value={draftValue} onChange={e=>setDraftValue(e.target.value)} className="rounded-[8px] font-mono text-xs" />
              <Input placeholder="备注（可选，本地存储）" value={draftNote} onChange={e=>setDraftNote(e.target.value)} className="rounded-[8px] text-xs" />
            </div>
            <DialogFooter><Button variant="outline" onClick={()=>setDialogOpen(false)} className="rounded-[8px]">取消</Button><Button onClick={handleSave} disabled={!draftValue.trim()||busy} className="rounded-[8px]">{busy?"保存中…":"保存"}</Button></DialogFooter>
          </div>
        </div> : null}
      </Dialog>
    </div>
  );
}
