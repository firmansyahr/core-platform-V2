"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center space-y-6 max-w-sm">
        <div className="space-y-1">
          <p className="text-8xl font-extrabold tabular-nums text-muted-foreground/20 select-none">
            500
          </p>
          <h1 className="text-xl font-bold tracking-tight">Terjadi kesalahan</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Sesuatu yang tidak terduga terjadi. Silakan coba lagi atau kembali ke dashboard.
          </p>
          {error.digest && (
            <p className="text-[11px] font-mono text-muted-foreground/50 mt-1">
              ref: {error.digest}
            </p>
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold
              hover:bg-foreground/90 transition-colors"
          >
            Coba lagi
          </button>
          <Link
            href="/"
            className="px-5 py-2.5 rounded-lg border border-border text-sm font-medium
              hover:bg-muted transition-colors"
          >
            Kembali ke Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
