import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

type AclEntry = { id: string; value: string; note: string; createdAt: string };
type TabKey = "ip" | "domain" | "ua" | "remark";

const INITIAL: Record<TabKey, AclEntry[]> = {
  ip: [
    { id: "ip1", value: "203.0.113.0/24", note: "block range", createdAt: "2026-08-20" },
    { id: "ip2", value: "198.51.100.42", note: "", createdAt: "2026-08-21" },
  ],
  domain: [{ id: "d1", value: "malicious.example.com", note: "phishing", createdAt: "2026-08-19" }],
  ua: [{ id: "u1", value: "curl/.*", note: "block curl UA", createdAt: "2026-08-18" }],
  remark: [{ id: "r1", value: "exclude:Free", note: "filter by remark", createdAt: "2026-08-17" }],
};

export default function AclPage() {
  const [enableBlacklist, setEnableBlacklist] = useState(true);
  const [enableWhitelist, setEnableWhitelist] = useState(false);
  const [active, setActive] = useState<TabKey>("ip");
  const [data, setData] = useState<Record<TabKey, AclEntry[]>>(INITIAL);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AclEntry | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [dialogTab, setDialogTab] = useState<TabKey>("ip");

  const isAnyDisabled = !enableBlacklist && !enableWhitelist;

  const openAdd = (tab: TabKey) => {
    setDialogTab(tab);
    setEditing(null);
    setDraftValue("");
    setDraftNote("");
    setDialogOpen(true);
  };
  const openEdit = (tab: TabKey, entry: AclEntry) => {
    setDialogTab(tab);
    setEditing(entry);
    setDraftValue(entry.value);
    setDraftNote(entry.note);
    setDialogOpen(true);
  };
  const handleSave = () => {
    const v = draftValue.trim();
    if (!v) return;
    if (editing) {
      setData((prev) => ({ ...prev, [dialogTab]: prev[dialogTab].map((x) => (x.id === editing.id ? { ...x, value: v, note: draftNote.trim() } : x)) }));
    } else {
      setData((prev) => ({
        ...prev,
        [dialogTab]: [...prev[dialogTab], { id: String(Date.now()), value: v, note: draftNote.trim(), createdAt: new Date().toISOString().slice(0, 10) }],
      }));
    }
    setDialogOpen(false);
  };
  const handleDelete = (tab: TabKey, id: string) => {
    setData((prev) => ({ ...prev, [tab]: prev[tab].filter((x) => x.id !== id) }));
  };

  const renderTable = (tab: TabKey, label: string) => {
    const rows = data[tab];
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-[rgb(0_0_0/44%)]">{label}</p>
          <Button size="sm" variant="outline" onClick={() => openAdd(tab)}>Add</Button>
        </div>
        {rows.length === 0 ? (
          <div className="rounded-[8px] border px-4 py-10 text-center text-sm text-[rgb(0_0_0/44%)]">No rules. Use Add to create one.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Value</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-[140px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.value}</TableCell>
                  <TableCell className="text-xs text-[rgb(0_0_0/64%)]">{r.note || "—"}</TableCell>
                  <TableCell className="text-xs text-[rgb(0_0_0/44%)]">{r.createdAt}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(tab, r)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(tab, r.id)}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold leading-none">ACL</h1>
        <p className="mt-1 text-sm text-[rgb(0_0_0/44%)]">Blacklist and whitelist with independent toggles. Disabled lists are paused but retained.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Blocklist</CardTitle>
            <CardDescription>When enabled, matching requests are denied.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable blacklist</p>
                <p className="text-xs text-[rgb(0_0_0/44%)]">Meta: turn off to skip blacklist checks</p>
              </div>
              <Switch checked={enableBlacklist} onCheckedChange={setEnableBlacklist} aria-label="Enable blacklist" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Allowlist</CardTitle>
            <CardDescription>When enabled, only listed entries are allowed.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable whitelist</p>
                <p className="text-xs text-[rgb(0_0_0/44%)]">Meta: turn off to skip whitelist checks</p>
              </div>
              <Switch checked={enableWhitelist} onCheckedChange={setEnableWhitelist} aria-label="Enable whitelist" />
            </div>
          </CardContent>
        </Card>
      </div>

      {isAnyDisabled && (
        <div className="rounded-[8px] border border-[rgb(0_0_0/10%)] bg-zinc-50 px-4 py-3 text-xs text-[rgb(0_0_0/64%)]">
          ACL checks paused — a disabled list keeps its rules but is not enforced. Rules remain editable for later activation.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>Four groups, each with table and dialog. Disable a list to pause enforcement without deleting rules.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className={isAnyDisabled ? "opacity-60" : ""}>
            <Tabs value={active} onValueChange={(v) => setActive(v as TabKey)}>
              <TabsList>
                <TabsTrigger value="ip">IP / CIDR</TabsTrigger>
                <TabsTrigger value="domain">URL Domain</TabsTrigger>
                <TabsTrigger value="ua">UA RegExp</TabsTrigger>
                <TabsTrigger value="remark">Remark RegExp</TabsTrigger>
              </TabsList>
              {!enableBlacklist && !enableWhitelist && <p className="pt-2 text-xs text-[rgb(0_0_0/44%)]">Paused — enable either list to enforce. Editing still allowed.</p>}
              <TabsContent value="ip">{renderTable("ip", "IP or CIDR entries")}</TabsContent>
              <TabsContent value="domain">{renderTable("domain", "Domain entries — exact or suffix match")}</TabsContent>
              <TabsContent value="ua">{renderTable("ua", "User-Agent regular expressions")}</TabsContent>
              <TabsContent value="remark">{renderTable("remark", "Remark patterns: include / exclude")}</TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit rule" : "Add rule"}</DialogTitle>
          <DialogDescription>
            {dialogTab === "ip" && "IP or CIDR, e.g. 203.0.113.0/24"}
            {dialogTab === "domain" && "Domain, e.g. example.com"}
            {dialogTab === "ua" && "RegExp for User-Agent"}
            {dialogTab === "remark" && "RegExp for remark include/exclude"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Value</label>
            <Input value={draftValue} onChange={(e) => setDraftValue(e.target.value)} placeholder={dialogTab === "ua" || dialogTab === "remark" ? "RegExp pattern" : "Enter value"} className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Note</label>
            <Input value={draftNote} onChange={(e) => setDraftNote(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!draftValue.trim()}>{editing ? "Save" : "Add"}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
