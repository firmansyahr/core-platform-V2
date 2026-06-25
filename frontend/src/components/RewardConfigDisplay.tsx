"use client";

const TIER_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-green-100 text-green-700",
  "bg-yellow-100 text-yellow-700",
  "bg-pink-100 text-pink-700",
];

const fmtNum = (n: number) => new Intl.NumberFormat("id-ID").format(n);

function MultiTierDisplay({ rc }: { rc: Record<string, unknown> }) {
  type TierRow = { tier_id: number; label: string; threshold_pct: number; multiplier: number; keterangan?: string };
  const tiers = (rc.tiers as TierRow[] | undefined) ?? [];
  const reguler = (rc.reguler_multiplier as number) ?? 1;
  const overflow = (rc.overflow_multiplier as number) ?? 1;
  const catatan = rc.catatan as string | undefined;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Struktur Tier Reward</p>

      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border">
        <div className="flex items-center gap-2">
          <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">Reguler</span>
          <span className="text-xs text-muted-foreground">Volume di bawah threshold tier pertama</span>
        </div>
        <span className="text-sm font-bold text-gray-600">{reguler}×</span>
      </div>

      {tiers.map((t, i) => (
        <div key={t.tier_id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border">
          <div className="flex items-center gap-2">
            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${TIER_COLORS[i % TIER_COLORS.length]}`}>
              {t.label}
            </span>
            <span className="text-xs text-muted-foreground">
              Achievement ≥ {t.threshold_pct}%{t.keterangan ? ` · ${t.keterangan}` : ""}
            </span>
          </div>
          <span className={`text-sm font-bold ${TIER_COLORS[i % TIER_COLORS.length].split(" ")[1]}`}>{t.multiplier}×</span>
        </div>
      ))}

      {overflow > 1 && (
        <div className="flex items-center justify-between px-3 py-2 bg-indigo-50 rounded-lg border border-indigo-100">
          <div className="flex items-center gap-2">
            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700">Overflow</span>
            <span className="text-xs text-muted-foreground">Volume melebihi tier tertinggi</span>
          </div>
          <span className="text-sm font-bold text-indigo-700">{overflow}×</span>
        </div>
      )}

      {catatan && <p className="text-xs text-muted-foreground mt-1">{catatan}</p>}
    </div>
  );
}

function FlatMultiplierDisplay({ rc }: { rc: Record<string, unknown> }) {
  const multiplier = (rc.multiplier as number) ?? 1;
  const brandFilter = (rc.brand_filter as string[]) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Multiplier</p>
        <span className="inline-flex px-3 py-1 rounded-full text-sm font-bold bg-blue-100 text-blue-700">{multiplier}×</span>
      </div>
      {brandFilter.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Brand Filter</p>
          <div className="flex flex-wrap gap-1.5">
            {brandFilter.map(b => (
              <span key={b} className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">{b}</span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Toko yang tidak memiliki brand ini mendapat 1× (tidak berlipat)
          </p>
        </div>
      )}
    </div>
  );
}

function LeaderboardDisplay({ rc }: { rc: Record<string, unknown> }) {
  type RankReward = { rank?: number; rank_range?: number[]; label: string; reward_value: number };
  const basis = rc.basis_ranking as string | undefined;
  const scope = rc.scope as string | undefined;
  const bentuk = rc.bentuk_reward as string | undefined;
  const minTrx = rc.minimum_transaksi as number | undefined;
  const rankRewards = (rc.rank_rewards as RankReward[]) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Basis Ranking</p>
          <p className="text-sm font-semibold">
            {basis === "volume" ? "Volume (ton)" : basis === "growth_pct" ? "Growth %" : (basis ?? "–")}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Scope</p>
          <p className="text-sm font-semibold">
            {scope === "global" ? "Global" : scope === "per_cluster" ? "Per Cluster" : (scope ?? "–")}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Bentuk Reward</p>
          <p className="text-sm font-semibold capitalize">{bentuk ?? "–"}</p>
        </div>
      </div>

      {rankRewards.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Reward per Posisi</p>
          <div className="space-y-1.5">
            {rankRewards.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium">{r.label}</span>
                <span className="text-sm font-bold text-purple-700">
                  {bentuk === "poin"
                    ? `${fmtNum(r.reward_value)} poin`
                    : `Rp ${fmtNum(r.reward_value)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {minTrx && minTrx > 1 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Minimum transaksi: {minTrx} kali untuk eligible ranking
        </p>
      )}
    </div>
  );
}

function FlatPerBatchDisplay({ rc }: { rc: Record<string, unknown> }) {
  const tonPerPoin = (rc.ton_per_poin as number) ?? 2;
  const brandFilter = (rc.brand_filter as string[]) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Konversi Poin</p>
        <span className="inline-flex px-3 py-1 rounded-full text-sm font-bold bg-teal-100 text-teal-700">{tonPerPoin} ton = 1 poin</span>
      </div>
      <div className="bg-teal-50 border border-teal-100 rounded-lg p-3 text-xs text-teal-800 space-y-0.5">
        <p>10 ton → {(10 / tonPerPoin).toFixed(2)} poin</p>
        <p>50 ton → {(50 / tonPerPoin).toFixed(2)} poin</p>
        <p>100 ton → {(100 / tonPerPoin).toFixed(2)} poin</p>
      </div>
      {brandFilter.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Brand Filter</p>
          <div className="flex flex-wrap gap-1.5">
            {brandFilter.map(b => (
              <span key={b} className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">{b}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RewardConfigDisplay({
  tipe_program,
  reward_config,
}: {
  tipe_program?: string;
  reward_config?: Record<string, unknown>;
}) {
  if (!reward_config) return <p className="text-sm text-muted-foreground">Konfigurasi tidak tersedia</p>;
  if (tipe_program === "multi_tier") return <MultiTierDisplay rc={reward_config} />;
  if (tipe_program === "flat_multiplier") return <FlatMultiplierDisplay rc={reward_config} />;
  if (tipe_program === "flat_per_batch") return <FlatPerBatchDisplay rc={reward_config} />;
  if (tipe_program === "leaderboard") return <LeaderboardDisplay rc={reward_config} />;

  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-auto max-h-48">
        {JSON.stringify(reward_config, null, 2)}
      </pre>
    </div>
  );
}
