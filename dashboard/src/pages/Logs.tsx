import { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectItem } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type LogRow = {
  id: string;
  time: string;
  ip: string;
  ipMasked: string;
  target: string;
  nodes: number;
  cache: "hit" | "miss";
  status: number;
  duration: number;
  urlMasked: string;
  subInfo: string;
  upstream: string;
};

const MOCK_LOGS: LogRow[] = [
  {
    id: "1",
    time: "2026-08-26 14:22:03",
    ip: "203.0.113.42",
    ipMasked: "203.0.113.***",
    target: "clash",
    nodes: 42,
    cache: "hit",
    status: 200,
    duration: 87,
    urlMasked: "https://sub.example.com/sub?target=clash&url=***&insert=false",
    subInfo: "upload=12345678; download=98765432; total=107374182400; expire=1780000000",
    upstream: "origin: https://raw.example.com/nodes.txt (42 nodes)",
  },
  {
    id: "2",
    time: "2026-08-26 13:58:11",
    ip: "198.51.100.9",
    ipMasked: "198.51.100.***",
    target: "surge",
    nodes: 18,
    cache: "miss",
    status: 200,
    duration: 143,
    urlMasked: "https://sub.example.com/sub?target=surge&url=***",
    subInfo: "upload=0; download=0; total=53687091200; expire=1779000000",
    upstream: "origin: https://raw.example.com/list.txt (18 nodes)",
  },
  {
    id: "3",
    time: "2026-08-26 13:42:44",
    ip: "192.0.2.88",
    ipMasked: "192.0.2.***",
    target: "clash",
    nodes: 0,
    cache: "miss",
    status: 403,
    duration: 12,
    urlMasked: "https://sub.example.com/sub?target=clash&url=***",
    subInfo: "—",
    upstream: "blocked_by_allowlist",
  },
];

function statusVariant(status: number): "success" | "destructive" | "secondary" {
  if (status >= 200 && status < 300) return "success";
  if (status >= 400) return "destructive";
  return "secondary";
}

export default function LogsPage() {
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState("all");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [retention, setRetention] = useState("180");
  const [retentionSaved, setRetentionSaved] = useState("180");
  const [selected, setSelected] = useState<LogRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [blockedIps, setBlockedIps] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return MOCK_LOGS.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        if (!(r.ip.toLowerCase().includes(q) || r.target.toLowerCase().includes(q))) return false;
      }
      if (target !== "all" && r.target !== target) return false;
      if (status !== "all" && String(r.status) !== status) return false;
      if (dateFrom && r.time < dateFrom) return false;
      if (dateTo && r.time > dateTo + " 23:59:59") return false;
      return true;
    });
  }, [search, target, status, dateFrom, dateTo]);

  const nextPurgeAt = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(3, 0, 0, 0);
    return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }, []);

  function handleExportCsv() {
    const header = ["time", "ip", "target", "nodes", "cache", "status", "duration_ms"];
    const rows = filtered.map((r) => [r.time, r.ipMasked, r.target, String(r.nodes), r.cache, String(r.status), String(r.duration)]);
    const csv = [header, ...rows].map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openDetail(row: LogRow) {
    setSelected(row);
    setSheetOpen(true);
  }

  function handleBlockIp(ip: string) {
    setBlockedIps((prev) => new Set(prev).add(ip));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Logs</h1>
        <p className="text-sm text-[rgb(0_0_0/44%)]">Access and block events. Retention default 180d.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Search IP/target, status, date range, retention, export.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Search IP or target" className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="w-[160px]">
              <Select value={target} onValueChange={setTarget} aria-label="Target">
                <SelectItem value="all">All targets</SelectItem>
                <SelectItem value="clash">clash</SelectItem>
                <SelectItem value="clashr">clashr</SelectItem>
                <SelectItem value="surge">surge</SelectItem>
                <SelectItem value="quan">quan</SelectItem>
                <SelectItem value="loon">loon</SelectItem>
                <SelectItem value="v2ray">v2ray</SelectItem>
              </Select>
            </div>
            <div className="w-[140px]">
              <Select value={status} onValueChange={setStatus} aria-label="Status">
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="200">200</SelectItem>
                <SelectItem value="403">403</SelectItem>
                <SelectItem value="500">500</SelectItem>
              </Select>
            </div>
            <Button variant="outline" onClick={handleExportCsv}>
              Export CSV
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[rgb(0_0_0/64%)]">Date range</label>
              <div className="flex gap-2">
                <Input type="date" className="w-[160px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
                <span className="self-center text-xs text-[rgb(0_0_0/44%)]">—</span>
                <Input type="date" className="w-[160px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
              </div>
              <p className="text-[11px] text-[rgb(0_0_0/44%)]">Default 24h window when empty.</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[rgb(0_0_0/64%)]">Retention</label>
              <div className="w-[160px]">
                <Select value={retention} onValueChange={setRetention} aria-label="Retention">
                  <SelectItem value="7">7d</SelectItem>
                  <SelectItem value="30">30d</SelectItem>
                  <SelectItem value="90">90d</SelectItem>
                  <SelectItem value="180">180d</SelectItem>
                  <SelectItem value="365">365d</SelectItem>
                </Select>
              </div>
            </div>

            <Button variant="secondary" onClick={() => setRetentionSaved(retention)} className="h-9">
              Apply retention
            </Button>
            {retention !== retentionSaved ? <span className="text-xs text-amber-700">Unsaved change</span> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Nodes</TableHead>
                <TableHead>Cache</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-[rgb(0_0_0/44%)]">
                    No logs in this window.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => openDetail(row)}>
                    <TableCell className="font-mono text-xs">{row.time}</TableCell>
                    <TableCell className="font-mono text-xs">{row.ipMasked}</TableCell>
                    <TableCell>{row.target}</TableCell>
                    <TableCell>{row.nodes}</TableCell>
                    <TableCell>
                      <Badge variant={row.cache === "hit" ? "secondary" : "outline"}>{row.cache}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.duration} ms</TableCell>
                    <TableCell>
                      <Button
                        variant={blockedIps.has(row.ip) ? "secondary" : "outline"}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBlockIp(row.ip);
                        }}
                        disabled={blockedIps.has(row.ip)}
                      >
                        {blockedIps.has(row.ip) ? "Blocked" : "Block IP"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-[rgb(0_0_0/44%)]">Row click opens detail drawer. IPs are desensitized; full IP only visible to allow block action.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Log retention</CardTitle>
          <CardDescription>How long access logs are kept before scheduled purge.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="w-[180px]">
            <Select value={retentionSaved} onValueChange={(v) => { setRetention(v); setRetentionSaved(v); }} aria-label="Retention card">
              <SelectItem value="7">7d</SelectItem>
              <SelectItem value="30">30d</SelectItem>
              <SelectItem value="90">90d</SelectItem>
              <SelectItem value="180">180d</SelectItem>
              <SelectItem value="365">365d</SelectItem>
            </Select>
          </div>
          <div className="text-sm">
            <span className="font-medium">Current {retentionSaved}d</span>
            <span className="mx-2 text-[rgb(0_0_0/18%)]">·</span>
            <span className="text-[rgb(0_0_0/64%)]">~{(Number(retentionSaved) * 0.42).toFixed(1)} MB estimated</span>
            <span className="mx-2 text-[rgb(0_0_0/18%)]">·</span>
            <span className="text-xs text-[rgb(0_0_0/44%)]">next purge {nextPurgeAt}</span>
          </div>
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Request detail</SheetTitle>
            <SheetDescription>Desensitized. Raw subscription is never shown.</SheetDescription>
          </SheetHeader>
          {selected ? (
            <div className="space-y-4 text-sm">
              <div className="space-y-1">
                <div className="text-xs font-medium text-[rgb(0_0_0/64%)]">Time</div>
                <div className="font-mono text-xs">{selected.time}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-[rgb(0_0_0/64%)]">IP (masked)</div>
                <div className="font-mono text-xs">{selected.ipMasked}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-[rgb(0_0_0/64%)]">Request URL (masked)</div>
                <div className="break-all rounded-[8px] border bg-zinc-50 p-3 font-mono text-xs">{selected.urlMasked}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-[rgb(0_0_0/64%)]">Sub info</div>
                <div className="break-all rounded-[8px] border bg-zinc-50 p-3 font-mono text-xs">{selected.subInfo}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-[rgb(0_0_0/64%)]">Upstream</div>
                <div className="break-all rounded-[8px] border bg-zinc-50 p-3 font-mono text-xs">{selected.upstream}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-[8px] border p-3">
                  <div className="text-[rgb(0_0_0/44%)]">Target</div>
                  <div className="font-medium">{selected.target}</div>
                </div>
                <div className="rounded-[8px] border p-3">
                  <div className="text-[rgb(0_0_0/44%)]">Cache</div>
                  <div className="font-medium">{selected.cache}</div>
                </div>
                <div className="rounded-[8px] border p-3">
                  <div className="text-[rgb(0_0_0/44%)]">Status</div>
                  <div className="font-medium">{selected.status}</div>
                </div>
                <div className="rounded-[8px] border p-3">
                  <div className="text-[rgb(0_0_0/44%)]">Duration</div>
                  <div className="font-medium">{selected.duration} ms</div>
                </div>
              </div>
              <Button
                variant={blockedIps.has(selected.ip) ? "secondary" : "destructive"}
                onClick={() => handleBlockIp(selected.ip)}
                disabled={blockedIps.has(selected.ip)}
                className="w-full"
              >
                {blockedIps.has(selected.ip) ? "IP already blocked" : `Block ${selected.ipMasked}`}
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
