import { createBrowserRouter, RouterProvider, Navigate, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import AuthPage from "@/pages/Auth";
import GeneratePage from "@/pages/Generate";
import DomainsPage from "@/pages/Domains";
import AclPage from "@/pages/Acl";
import LimitsPage from "@/pages/Limits";
import LogsPage from "@/pages/Logs";
import CachePage from "@/pages/Cache";
import ConfigPage from "@/pages/Config";
import DebugPage from "@/pages/Debug";
import { isAuthenticated } from "@/lib/auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

function RequireAuth() {
  if (!isAuthenticated()) {
    return <Navigate to="/dashboard/auth" replace />;
  }
  return <Outlet />;
}

function DashboardRedirect() {
  if (isAuthenticated()) {
    return <Navigate to="/dashboard/generate" replace />;
  }
  return <Navigate to="/dashboard/auth" replace />;
}

const router = createBrowserRouter([
  {
    path: "/dashboard/auth",
    element: <AuthPage />,
  },
  {
    path: "/dashboard",
    element: <Layout />,
    children: [
      { index: true, element: <DashboardRedirect /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "generate", element: <GeneratePage /> },
          { path: "domains", element: <DomainsPage /> },
          { path: "acl", element: <AclPage /> },
          { path: "limits", element: <LimitsPage /> },
          { path: "logs", element: <LogsPage /> },
          { path: "cache", element: <CachePage /> },
          { path: "config", element: <ConfigPage /> },
          { path: "debug", element: <DebugPage /> },
        ],
      },
    ],
  },
  { path: "/", element: <Navigate to="/dashboard" replace /> },
  { path: "*", element: <Navigate to="/dashboard" replace /> },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
