import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { clearToken, getToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Globe,
  Shield,
  Gauge,
  ScrollText,
  Database,
  Settings,
  Bug,
  LogOut,
} from "lucide-react";

const navGroups: { label: string; items: { to: string; label: string; icon: React.ElementType }[] }[] = [
  {
    label: "转换",
    items: [
      { to: "/dashboard/generate", label: "生成", icon: FileText },
      { to: "/dashboard/debug", label: "调试", icon: Bug },
    ],
  },
  {
    label: "运维",
    items: [
      { to: "/dashboard/domains", label: "域名管理", icon: Globe },
      { to: "/dashboard/acl", label: "访问控制", icon: Shield },
      { to: "/dashboard/limits", label: "限流", icon: Gauge },
      { to: "/dashboard/logs", label: "日志", icon: ScrollText },
      { to: "/dashboard/cache", label: "缓存", icon: Database },
    ],
  },
  {
    label: "系统",
    items: [{ to: "/dashboard/config", label: "配置", icon: Settings }],
  },
];

export function Layout() {
  const navigate = useNavigate();
  const token = getToken();

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      {/* Top bar 48px */}
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b bg-white px-4">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-[6px] bg-zinc-900" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">subconverter-ts</span>
          <span className="text-xs text-[rgb(0_0_0/44%)]">面板</span>
        </div>
        <div className="flex items-center gap-2">
          {token ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                clearToken();
                navigate("/dashboard/auth");
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              退出登录
            </Button>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex max-w-[1280px]">
        {/* Sidebar 240px */}
        <aside className="hidden w-[240px] shrink-0 border-r md:block">
          <nav className="sticky top-12 p-3">
            {navGroups.map((group) => (
              <div key={group.label} className="mb-4">
                <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-[rgb(0_0_0/44%)]">
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm",
                            isActive
                              ? "bg-[rgb(0_0_0/5%)] font-medium"
                              : "text-[rgb(0_0_0/64%)] hover:bg-[rgb(0_0_0/5%)] hover:text-zinc-900",
                          )
                        }
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 p-6 md:p-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 flex gap-1 overflow-x-auto border-t bg-white p-2 md:hidden">
        {navGroups.flatMap((g) => g.items).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 py-1.5 text-xs",
                isActive ? "bg-[rgb(0_0_0/5%)] font-medium" : "text-[rgb(0_0_0/64%)]",
              )
            }
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
