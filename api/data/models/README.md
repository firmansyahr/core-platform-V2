# Causal ML — Catatan Sumber Data

Model Causal ML (`causal_training_result.json`) dilatih menggunakan SNAPSHOT
`loyalty_members.json` yang di-regenerasi khusus untuk keperluan training (300
toko dengan distribusi `tgl_masuk` realistis, lihat
`api/scripts/regenerate_loyalty_enrollment.py` untuk detail).

Dataset ini TERPISAH dari data loyalty production yang live di Railway Volume
(`/mnt/data`) — production menyimpan member ASLI hasil input pengguna
sungguhan (saat ini ~180 member dengan `tgl_masuk` Juni 2026, yang TIDAK
memiliki variasi temporal cukup untuk causal inference yang valid).

**Keputusan sadar**: 300 member regenerasi ini TETAP sebagai dataset training
lokal terpisah, TIDAK didorong ke volume production — 180 member asli di
production punya riwayat audit nyata (real user activity) yang berharga
untuk demo, dan tidak boleh tercampur/rusak oleh data sintetis training.

## Implikasi

`GET /api/causal/store/{id_toko}` hanya akan mengembalikan hasil CATE untuk
toko-toko yang ada di dataset training (300 sampel), BUKAN seluruh member
yang aktif di production saat ini. Untuk toko di luar sampel, endpoint
mengembalikan `status: "not_in_training_sample"` (HTTP 200, bukan 404) —
toko itu sendiri valid, hanya di luar sampel training.

`GET /api/causal/summary` tetap valid sebagai estimasi ATE umum platform
(tidak bergantung pada id_toko spesifik mana yang aktif).

## Re-training di masa depan

Untuk re-training dengan data production yang sebenarnya, perlu menunggu
hingga member production memiliki variasi `tgl_masuk` yang cukup (minimal
beberapa bulan rentang waktu, bukan terkonsentrasi di satu hari/minggu), atau
melakukan regenerasi terkontrol seperti yang sudah dilakukan untuk dataset
training saat ini.

## File terkait

- `api/scripts/regenerate_loyalty_enrollment.py` — generator dataset training (300 toko)
- `api/scripts/train_causal_model.py` — entry point training lokal (full dataset, 21.014 toko)
- `api/core/causal_engine.py` — implementasi panel event-time DiD (DoWhy + EconML)
- `api/routers/causal.py` — endpoint read-only production + Training Policy (lihat docstring modul)
