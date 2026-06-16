"use client";

import { getToken } from "@/lib/auth";

/**
 * Fetch a file from the API and trigger a browser download.
 * Works for both GET (PDF/CSV) and POST (PDF with body).
 */
export async function downloadFile(
  url: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
  filename?: string,
): Promise<void> {
  const token = getToken();

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body)  headers["Content-Type"]  = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg);
  }

  const blob      = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  const a        = document.createElement("a");
  a.href         = objectUrl;
  a.download     = filename ?? _filenameFromResponse(res) ?? `download_${Date.now()}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

function _filenameFromResponse(res: Response): string | null {
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m  = cd.match(/filename="?([^";]+)"?/);
  return m?.[1] ?? null;
}
