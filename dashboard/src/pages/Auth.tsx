import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { setToken } from "@/lib/auth";

export default function AuthPage() {
  const [token, setTokenValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token.trim()) {
      setError("请输入令牌。");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/dashboard/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (res.ok) {
        setToken(token.trim());
        navigate("/dashboard/generate");
      } else if (res.status === 404) {
        // fallback for local dev without backend
        setToken(token.trim());
        navigate("/dashboard/generate");
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "令牌无效.");
      }
    } catch {
      // offline fallback for dev
      setToken(token.trim());
      navigate("/dashboard/generate");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4">
      <Card className="w-full max-w-[360px] rounded-[8px] border shadow-none">
        <CardHeader className="pb-4">
          <CardTitle className="text-[18px] font-semibold tracking-tight">登录</CardTitle>
          <CardDescription className="text-sm">需要管理员令牌</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="token" className="text-sm font-medium leading-none">
                令牌
              </label>
              <Input
                id="token"
                type="password"
                placeholder="请输入面板令牌"
                value={token}
                onChange={(e) => setTokenValue(e.target.value)}
                autoComplete="current-password"
                className="rounded-[8px]"
              />
            </div>
            {error ? (
              <Alert variant="destructive" className="rounded-[8px]">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button
              type="submit"
              className="w-full rounded-[8px] bg-zinc-900 text-white hover:bg-zinc-800"
              disabled={loading}
            >
              {loading ? "校验中…" : "继续"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
