import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

type Ruleset = {
  name: string;
  type: number;
  url: string;
  count: number;
  updatedAt: string;
};

const MOCK_RULESETS: Ruleset[] = [
  { name: "reject", type: 1, url: "base/rules/reject.txt", count: 4821, updatedAt: "2026-08-26 08:00" },
  { name: "proxy", type: 2, url: "base/rules/proxy.txt", count: 1240, updatedAt: "2026-08-26 08:00" },
  { name: "direct", type: 3, url: "base/rules/direct.txt", count: 892, updatedAt: "2026-08-26 08:00" },
  { name: "lancidr", type: 4, url: "base/rules/lancidr.txt", count: 312, updatedAt: "2026-08-26 08:00" },
  { name: "cncidr", type: 5, url: "base/rules/cncidr.txt", count: 428, updatedAt: "2026-08-25 22:14" },
  { name: "telegramcidr", type: 6, url: "base/rules/telegramcidr.txt", count: 67, updatedAt: "2026-08-25 22:14" },
];

export default function CachePage() {
  const [flushOpen, setFlushOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [hitRate] = useState(68.4);
  const [entries] = useState(1247);
  const [status, setStatus] = useState<string | null>(null);

  function handleFlush() {
    setStatus("Cache flushed. Next request will miss and rebuild.");
    setTimeout(() => setStatus(null), 3000);
  }

  function handleRefresh() {
    setStatus("Rulesets refreshed from base/rules.");
    setTimeout(() => setStatus(null), 3000);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Cache</h1>
        <p className="text-sm text-[rgb(0_0_0/44%)]">Hit rate and ruleset management.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Hit rate</CardTitle>
            <CardDescription>Requests served from cache</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight">{hitRate.toFixed(1)}%</span>
              <span className="text-xs text-[rgb(0_0_0/44%)]">last 24h</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full rounded-full bg-zinc-900" style={{ width: `${hitRate}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Entries</CardTitle>
            <CardDescription>Cached conversions</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold tracking-tight">{entries.toLocaleString()}</span>
            <p className="mt-1 text-xs text-[rgb(0_0_0/44%)]">TTL 60s per key</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Rulesets</CardTitle>
            <CardDescription>Type 1–6 from base/rules</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold tracking-tight">{MOCK_RULESETS.length}</span>
            <p className="mt-1 text-xs text-[rgb(0_0_0/44%)]">Loaded at startup, refresh on demand</p>
          </CardContent>
        </Card>
      </div>

      {status ? <div className="rounded-[8px] border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{status}</div> : null}

      <div className="flex gap-2">
        <AlertDialog open={flushOpen} onOpenChange={setFlushOpen}>
          <Button variant="outline" onClick={() => setFlushOpen(true)}>
            Flush cache
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Flush cache?</AlertDialogTitle>
              <AlertDialogDescription>All cached conversions will be evicted. Next requests will rebuild. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleFlush}>Flush</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={refreshOpen} onOpenChange={setRefreshOpen}>
          <Button variant="outline" onClick={() => setRefreshOpen(true)}>
            Refresh rulesets
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Refresh rulesets?</AlertDialogTitle>
              <AlertDialogDescription>Re-fetch rules from base/rules and reload type 1–6 sets. In-flight requests keep the prior snapshot.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRefresh}>Refresh</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rulesets</CardTitle>
          <CardDescription>Type 1–6. List from base/rules.</CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Rules</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MOCK_RULESETS.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.type}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate font-mono text-xs text-[rgb(0_0_0/64%)]">{r.url}</TableCell>
                  <TableCell className="font-mono text-xs">{r.count.toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs text-[rgb(0_0_0/64%)]">{r.updatedAt}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
