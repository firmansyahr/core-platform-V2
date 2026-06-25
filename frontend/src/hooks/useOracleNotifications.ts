"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, API } from "@/lib/fetch";

export interface OracleNotification {
  id: string;
  notif_type: string;
  title: string;
  summary: string;
  detail: unknown;
  severity: "info" | "warning" | "critical";
  is_read: boolean;
  is_dismissed: boolean;
  related_module: string | null;
  related_entity_id: string | null;
  created_at: string | null;
}

const POLL_INTERVAL_MS = 60_000;

export function useOracleNotifications() {
  const [notifications, setNotifications] = useState<OracleNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [listRes, countRes] = await Promise.all([
        apiFetch(`${API}/api/oracle/agent/notifications`),
        apiFetch(`${API}/api/oracle/agent/notifications/unread-count`),
      ]);
      const list = await listRes.json();
      const count = await countRes.json();
      setNotifications(list.data ?? []);
      setUnreadCount(count.data?.unread_count ?? 0);
    } catch {
      // diam-diam gagal — notifikasi bukan fitur kritikal, jangan ganggu UI lain
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  async function markRead(notifId: string) {
    try {
      await apiFetch(`${API}/api/oracle/agent/notifications/${notifId}/read`, { method: "POST" });
      setNotifications((prev) => prev.map((n) => (n.id === notifId ? { ...n, is_read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // no-op
    }
  }

  async function dismiss(notifId: string) {
    try {
      await apiFetch(`${API}/api/oracle/agent/notifications/${notifId}/dismiss`, { method: "POST" });
      setNotifications((prev) => prev.filter((n) => n.id !== notifId));
    } catch {
      // no-op
    }
  }

  return { notifications, unreadCount, loading, refresh, markRead, dismiss };
}
