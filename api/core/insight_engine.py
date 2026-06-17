import json
import os
import time

from anthropic import Anthropic

_client: Anthropic | None = None

def _get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    return _client

_insight_cache: dict[str, dict] = {}
_insight_cache_time: dict[str, float] = {}
CACHE_TTL = 3600


def generate_home_insight(summary_data: dict) -> dict:
    cache_key = "home_insight"
    now = time.time()

    if cache_key in _insight_cache:
        if now - _insight_cache_time.get(cache_key, 0) < CACHE_TTL:
            return {**_insight_cache[cache_key], "cached": True}

    if not os.getenv("ANTHROPIC_API_KEY"):
        return {"status": "disabled", "narasi": None, "cached": False}

    try:
        context = f"""
Data kondisi pasar bulan ini:
- Volume: {summary_data.get('volume_bulan_ini', 0):,.0f} TON
- Growth MoM: {summary_data.get('growth_mom_pct', 0):+.1f}%
- Growth YoY: {summary_data.get('growth_yoy_pct', 0):+.1f}%
- Toko aktif: {summary_data.get('toko_aktif', 0):,}
- Porsi produk murah (FBSI): {summary_data.get('fighting_brand_share_pct', 0):.1f}%
- Warning Merah: {summary_data.get('warning_merah', 0)} toko
- Warning Oranye: {summary_data.get('warning_oranye', 0)} toko
- Warning Kuning: {summary_data.get('warning_kuning', 0)} toko
- CAD Alert aktif: {summary_data.get('cad_alert_count', 0)} wilayah
- Volume at risk: {summary_data.get('volume_at_risk_pct', 0):.1f}% dari total
"""

        message = _get_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            system="""Kamu adalah analis bisnis senior untuk perusahaan
distributor semen. Tulis insight ringkas 3-4 kalimat dalam bahasa
Indonesia formal yang mudah dipahami manajemen. Fokus pada:
1. Kondisi utama bulan ini (positif atau negatif)
2. Area yang paling perlu perhatian
3. Satu rekomendasi tindakan konkret
Jangan gunakan bullet points. Jangan sebut nama perusahaan.
Tulis dalam 1 paragraf yang mengalir natural.""",
            messages=[
                {"role": "user", "content": f"Berikan insight berdasarkan data berikut:\n{context}"}
            ],
        )

        narasi = message.content[0].text
        result = {
            "status": "ok",
            "narasi": narasi,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "tokens_used": message.usage.input_tokens + message.usage.output_tokens,
            "cached": False,
        }

        _insight_cache[cache_key] = result
        _insight_cache_time[cache_key] = now
        return result

    except Exception as e:
        return {"status": "error", "narasi": None, "error": str(e), "cached": False}


def generate_store_insight(store_data: dict, shap_data: dict | None = None) -> dict:
    cache_key = f"store_{store_data.get('id_toko', '')}"
    now = time.time()

    if cache_key in _insight_cache:
        if now - _insight_cache_time.get(cache_key, 0) < CACHE_TTL:
            return {**_insight_cache[cache_key], "cached": True}

    if not os.getenv("ANTHROPIC_API_KEY"):
        return {"status": "disabled", "narasi": None, "cached": False}

    try:
        shap_text = ""
        if shap_data and shap_data.get("contributions"):
            top3 = shap_data["contributions"][:3]
            shap_text = "\nFaktor utama risiko:\n"
            for c in top3:
                arah = "meningkatkan" if c["direction"] == "meningkatkan_risiko" else "menurunkan"
                shap_text += f"- {c['label']}: {arah} risiko ({c['pct_contribution']:.0f}%)\n"

        context = f"""
Data toko:
- Nama: {store_data.get('nama_toko', '-')}
- Cluster: {store_data.get('cluster_pareto', '-')}
- AEGIS Score: {store_data.get('aegis_score', 0):.1f}
- Level: {store_data.get('level', '-')}
- Pola: {store_data.get('pola_kode', '-')}
- Churn Probability: {store_data.get('churn_prob', 0) * 100:.1f}%
{shap_text}
"""

        message = _get_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=250,
            system="""Kamu adalah analis bisnis senior. Tulis analisis
singkat 2-3 kalimat dalam bahasa Indonesia tentang kondisi toko ini
dan apa yang harus dilakukan tim sales. Bahasa formal, langsung ke
poin, fokus pada tindakan nyata yang bisa dilakukan TSO.""",
            messages=[
                {"role": "user", "content": f"Analisis kondisi toko:\n{context}"}
            ],
        )

        narasi = message.content[0].text
        result = {
            "status": "ok",
            "narasi": narasi,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "tokens_used": message.usage.input_tokens + message.usage.output_tokens,
            "cached": False,
        }

        _insight_cache[cache_key] = result
        _insight_cache_time[cache_key] = now
        return result

    except Exception as e:
        return {"status": "error", "narasi": None, "error": str(e), "cached": False}


def generate_cad_talking_points(wilayah: str, stores_data: list) -> dict:
    cache_key = f"cad_tp_{wilayah}"
    now = time.time()

    if cache_key in _insight_cache:
        if now - _insight_cache_time.get(cache_key, 0) < CACHE_TTL:
            return {**_insight_cache[cache_key], "cached": True}

    if not os.getenv("ANTHROPIC_API_KEY"):
        return {"status": "disabled", "talking_points": None, "cached": False}

    try:
        warning_count = len(stores_data)
        pola_counts: dict[str, int] = {}
        for s in stores_data:
            pola = s.get("pola_kode", "N")
            pola_counts[pola] = pola_counts.get(pola, 0) + 1

        context = f"""
Wilayah: {wilayah}
Total toko warning: {warning_count}
Distribusi pola: {json.dumps(pola_counts)}
"""

        message = _get_client().messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            system="""Kamu adalah manajer sales senior. Buat 3 talking
points singkat dalam bahasa Indonesia untuk TSO yang akan mengunjungi
wilayah ini. Format: poin bernomor, singkat dan actionable.""",
            messages=[
                {"role": "user", "content": f"Buat talking points kunjungan:\n{context}"}
            ],
        )

        result = {
            "status": "ok",
            "talking_points": message.content[0].text,
            "wilayah": wilayah,
            "tokens_used": message.usage.input_tokens + message.usage.output_tokens,
            "cached": False,
        }

        _insight_cache[cache_key] = result
        _insight_cache_time[cache_key] = now
        return result

    except Exception as e:
        return {"status": "error", "talking_points": None, "error": str(e), "cached": False}
