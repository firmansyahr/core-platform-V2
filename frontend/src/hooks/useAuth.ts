"use client";

import { useState, useEffect } from "react";
import { getUser } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth";

export interface UseAuth {
  user: AuthUser | null;
  role: string;
  isAdmin: boolean;
  isViewer: boolean;
}

export function useAuth(): UseAuth {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  const role = user?.role ?? "viewer";
  return {
    user,
    role,
    isAdmin: role === "admin",
    isViewer: role !== "admin",
  };
}
