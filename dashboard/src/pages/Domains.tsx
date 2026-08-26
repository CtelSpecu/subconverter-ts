import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

type AllowEntry = { id: string; domain: string; remark: string; addedAt: string };

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function DomainsPage() {
  const managedPrefix = typeof window !== "undefined" ? window.location.origin : "";
  const [copied, setCopied] = useState(false);
  const [allowlist, setAllowlist] = useState<AllowEntry[]>([
    { id: "1", domain: "sub.example.com", remark: "Primary frontend", addedAt: "2026-08-20" },
    { id: "2", domain: "dashboard.example.com", remark: "Admin panel", addedAt: "2026-08-22" },
  ]);
  const [addOpen, setAddOpen] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [remarkInput, setRemarkInput] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AllowEntry | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(managedPrefix);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // noop
    }
  };

  const handleAdd = () => {
    const v = domainInput.trim();
    if (!v || !confirmChecked) return;
    setAllowlist((prev) => [...prev, { id: String(Date.now()), domain: v, remark: remarkInput.trim(), addedAt: formatDate(new Date()) }]);
    setDomainInput("");
    setRemarkInput("");
    setConfirmChecked(false);
    setAddOpen(false);
  };

  const handleDelete = () => {
    if (!deleteTarget || !deleteConfirm) return;
    setAllowlist((prev) => prev.filter((x) => x.id !== deleteTarget.id));
    setDeleteTarget(null);
    setDeleteConfirm(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold leading-none">Domains</h1>
        <p className="mt-1 text-sm text-[rgb(0_0_0/44%)]">Managed prefix and frontend allowlist.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Managed prefix</CardTitle>
          <CardDescription>Read-only. Requires secret update and redeploy to change.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input readOnly value={managedPrefix} className="bg-zinc-50 font-mono text-xs" aria-label="Managed prefix" />
            <Button variant="outline" onClick={handleCopy} className="shrink-0">
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-[rgb(0_0_0/44%)]">Meta: update secret and redeploy to rotate this value. Displayed value is read-only in the dashboard.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Frontend allowlist</CardTitle>
              <CardDescription>Domains allowed to call /sub and /dashboard/api. Add requires confirmation.</CardDescription>
            </div>
            <Button onClick={() => setAddOpen(true)}>Add domain</Button>
          </div>
        </CardHeader>
        <CardContent>
          {allowlist.length === 0 ? (
            <div className="rounded-[8px] border px-4 py-10 text-center text-sm text-[rgb(0_0_0/44%)]">No domains configured. Add with confirmation.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Remark</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-[90px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allowlist.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.domain}</TableCell>
                    <TableCell className="text-xs text-[rgb(0_0_0/64%)]">{row.remark || "—"}</TableCell>
                    <TableCell className="text-xs text-[rgb(0_0_0/44%)]">{row.addedAt}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => { setDeleteTarget(row); setDeleteConfirm(false); }}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-3 text-xs text-[rgb(0_0_0/44%)]">CORS is governed by this allowlist. Requests from other origins receive 403 and are logged as blocked_by_allowlist.</p>
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogHeader>
          <DialogTitle>Add domain</DialogTitle>
          <DialogDescription>Enter a domain to allow. This change takes effect immediately and requires confirmation.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Domain</label>
            <Input placeholder="example.com" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Remark</label>
            <Input placeholder="Optional note" value={remarkInput} onChange={(e) => setRemarkInput(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 rounded-[8px] border bg-zinc-50 px-3 py-2.5">
            <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-zinc-300" />
            <span className="text-xs leading-4 text-[rgb(0_0_0/64%)]">I confirm this domain should be allowed to call /sub and /dashboard/api.</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={!domainInput.trim() || !confirmChecked}>Add</Button>
        </DialogFooter>
      </Dialog>

      {/* Delete confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteConfirm(false); } }}>
        <DialogHeader>
          <DialogTitle>Remove domain</DialogTitle>
          <DialogDescription>Domain {deleteTarget?.domain} will be removed from the allowlist. Requests from it will be rejected with 403.</DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 rounded-[8px] border bg-zinc-50 px-3 py-2.5">
          <input type="checkbox" checked={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-zinc-300" />
          <span className="text-xs leading-4 text-[rgb(0_0_0/64%)]">I understand this will block the domain immediately.</span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteConfirm(false); }}>Cancel</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={!deleteConfirm}>Delete</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
