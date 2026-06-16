"use client";

const COOKIE_NAME = "core_token";
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface AuthUser {
  username: string;
  name: string;
  role: string;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Login gagal");
  }
  const data = await res.json();
  const token: string = data.access_token;
  const maxAge: number = data.expires_in ?? 28800;
  document.cookie = `${COOKIE_NAME}=${token}; path=/; max-age=${maxAge}; SameSite=Lax`;
  return _decodeToken(token) as AuthUser;
}

export function logout(): void {
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  window.location.href = "/login";
}

export function getToken(): string | null {
  return _getCookie(COOKIE_NAME);
}

export function getUser(): AuthUser | null {
  const token = _getCookie(COOKIE_NAME);
  if (!token) return null;
  return _decodeToken(token);
}

function _getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function _decodeToken(token: string): AuthUser | null {
  try {
    const part = token.split(".")[1];
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return { username: json.sub ?? "", name: json.name ?? json.sub ?? "", role: json.role ?? "viewer" };
  } catch {
    return null;
  }
}
