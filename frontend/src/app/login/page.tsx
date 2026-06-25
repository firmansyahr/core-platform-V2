"use client";

export const dynamic = 'force-dynamic';

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { AnalyticsIcon } from "@hugeicons/core-free-icons";
import { login } from "@/lib/auth";

const toIcon = (i: unknown) => i as IconSvgElement;

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("from") ?? "/";
  const demoUser = searchParams.get("u");
  const demoPass = searchParams.get("p");
  const [username, setUsername] = useState(demoUser ?? "");
  const [password, setPassword] = useState(demoPass ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setError("");
    setLoading(true);
    try {
      await login(username.trim(), password);
      router.replace(redirectTo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login gagal");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 px-4">
      <div className="w-full max-w-md">

        {/* Brand */}
        <div className="flex flex-col items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-2xl bg-foreground flex items-center justify-center shadow-lg">
            <HugeiconsIcon icon={toIcon(AnalyticsIcon)} size={28} className="text-background" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">CORE Platform</h1>
            <p className="text-sm text-muted-foreground mt-1">Analitik Pasar Semen Kantong</p>
          </div>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-border bg-card shadow-xl p-8 space-y-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Masuk ke akun Anda</h2>
            <p className="text-sm text-muted-foreground">Gunakan kredensial yang diberikan administrator</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-base
                  placeholder:text-muted-foreground/50
                  focus:outline-none focus:ring-2 focus:ring-ring/60 focus:border-transparent
                  disabled:opacity-50 transition-all duration-150"
                disabled={loading}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-base
                  placeholder:text-muted-foreground/50
                  focus:outline-none focus:ring-2 focus:ring-ring/60 focus:border-transparent
                  disabled:opacity-50 transition-all duration-150"
                disabled={loading}
                required
              />
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3.5 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="w-full rounded-lg bg-foreground text-background px-4 py-2.5 text-base font-semibold
                hover:bg-foreground/88 disabled:opacity-40 disabled:cursor-not-allowed
                transition-all duration-150 shadow-sm
                focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 mt-1"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                  Masuk...
                </span>
              ) : (
                "Masuk"
              )}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginContent />
    </Suspense>
  );
}
