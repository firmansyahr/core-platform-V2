import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center space-y-6 max-w-sm">
        <div className="space-y-1">
          <p className="text-8xl font-extrabold tabular-nums text-muted-foreground/20 select-none">
            404
          </p>
          <h1 className="text-xl font-bold tracking-tight">Halaman tidak ditemukan</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Halaman yang Anda cari tidak ada atau telah dipindahkan.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-foreground
            text-background text-sm font-semibold hover:bg-foreground/90 transition-colors"
        >
          ← Kembali ke Dashboard
        </Link>
      </div>
    </div>
  );
}
