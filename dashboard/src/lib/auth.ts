export const TOKEN_KEY = "dashboard_token";

export function getToken(): string | null {
  try {
    return (
      localStorage.getItem(TOKEN_KEY) ??
      localStorage.getItem("auth_token") ??
      localStorage.getItem("DASHBOARD_TOKEN") ??
      null
    );
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("auth_token");
    localStorage.removeItem("DASHBOARD_TOKEN");
  } catch {
    // ignore
  }
}

export function isAuthenticated(): boolean {
  const t = getToken();
  return !!t && t.length > 0;
}

export function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
