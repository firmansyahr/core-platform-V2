"use client";

import { getToken } from "@/lib/auth";

export interface OracleStreamEvent {
  type: "text_delta" | "tool_start" | "tool_done" | "render_command" | "confidence" | "blocked" | "done";
  [key: string]: unknown;
}

export interface OracleChatBody {
  message: string;
  conversation_history: { role: string; content: string }[];
  page_context: unknown;
  session_id: string;
}

/**
 * Konsumsi SSE dari POST /api/oracle/chat/stream, satu event per callback.
 *
 * Buffering chunk yang belum lengkap (bukan split-per-chunk naif) — satu
 * "data: {...}\n\n" message SSE bisa terpotong di tengah oleh batas paket
 * network antar dua panggilan reader.read(); tanpa buffer, baris yang
 * terpotong gagal di-parse dan DIAM-DIAM hilang (bukan error yang terlihat).
 */
export async function streamOracleChat(
  apiBase: string,
  body: OracleChatBody,
  onEvent: (event: OracleStreamEvent) => void,
): Promise<void> {
  const token = getToken();
  const res = await fetch(`${apiBase}/api/oracle/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? ""; // sisa potongan belum lengkap, simpan untuk read berikutnya

    for (const block of blocks) {
      const line = block.trim();
      if (!line.startsWith("data: ")) continue;
      const data = line.slice("data: ".length);
      if (data === "[DONE]") return;
      try {
        onEvent(JSON.parse(data) as OracleStreamEvent);
      } catch {
        // chunk malformed — lewati, jangan crash seluruh stream
      }
    }
  }
}
