"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun, Settings, LogOut, Info, Menu, X, ChevronDown, FileText, Sparkles, Bell, Zap, Bot } from "lucide-react";
import { useOracleNotifications } from "@/hooks/useOracleNotifications";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  AnalyticsIcon,
  HomeIcon,
  AlertCircleIcon,
  BarChartIcon,
  AwardIcon,
  ChartUpIcon,
} from "@hugeicons/core-free-icons";
import { getUser, logout } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const toIcon = (i: unknown) => i as IconSvgElement;
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  viewer: "Viewer",
};

// ─── AEGIS dropdown items ─────────────────────────────────────────────────────

const AEGIS_ITEMS = [
  { label: "⚠️ AEGIS Monitor",            href: "/aegis" },
  { label: "🗺️ Peta Wilayah",             href: "/aegis/map" },
  { label: "📋 CAD Alert History",         href: "/aegis/cad-history" },
  { label: "⚔️ Competitor Intelligence",   href: "/competitor" },
];

// ─── Loyalty dropdown items ───────────────────────────────────────────────────

type LoyaltyItem = { label: string; href: string };
type LoyaltyGroup = { label: string; items: LoyaltyItem[] };

const LOYALTY_ITEMS: LoyaltyGroup[] = [
  {
    label: "Manajemen",
    items: [
      { label: "🏠 Overview",              href: "/loyalty" },
      { label: "👥 Peserta Aktif",         href: "/loyalty?tab=peserta" },
      { label: "📤 Toko Takeout",          href: "/loyalty?tab=takeout" },
    ],
  },
  {
    label: "Analisis & Rekomendasi",
    items: [
      { label: "⚡ Rekomendasi Take Out",  href: "/loyalty?tab=rekomendasi" },
      { label: "🎯 Target & Achievement",  href: "/loyalty?tab=target" },
      { label: "🎁 Smart Promotion",       href: "/loyalty?tab=promo" },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "📊 Referensi ILP",         href: "/loyalty?tab=ilp" },
      { label: "📋 Program Promo",         href: "/loyalty/promo" },
    ],
  },
  {
    label: "Lainnya",
    items: [
      { label: "🕐 History",               href: "/loyalty?tab=history" },
    ],
  },
];

export default function Navbar() {
  const pathname  = usePathname();
  const router    = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted,      setMounted]      = useState(false);
  const [user,         setUser]         = useState<AuthUser | null>(null);
  const [menuOpen,          setMenuOpen]          = useState(false);
  const [loyaltyOpen,       setLoyaltyOpen]       = useState(false);
  const [aegisOpen,         setAegisOpen]         = useState(false);
  const [intelligenceOpen,  setIntelligenceOpen]  = useState(false);
  const [openCount,    setOpenCount]    = useState(0);
  const [kritisCount,  setKritisCount]  = useState(0);
  const { notifications, unreadCount, markRead } = useOracleNotifications();

  useEffect(() => {
    setMounted(true);
    setUser(getUser());
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setLoyaltyOpen(false);
    setAegisOpen(false);
    setIntelligenceOpen(false);
  }, [pathname]);

  useEffect(() => {
    fetch(`${API}/api/aegis/cad-history/summary`)
      .then((r) => r.json())
      .then((r) => setOpenCount(r.data?.open ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const CACHE_KEY = "ac-kritis-count";
    const CACHE_TS  = "ac-kritis-ts";
    const TTL_MS    = 5 * 60 * 1000; // 5 minutes
    const cached    = sessionStorage.getItem(CACHE_KEY);
    const cachedTs  = Number(sessionStorage.getItem(CACHE_TS) ?? 0);
    if (cached && Date.now() - cachedTs < TTL_MS) {
      setKritisCount(parseInt(cached) || 0);
      return;
    }
    fetch(`${API}/api/action-center/items`, { signal: AbortSignal.timeout(10000) })
      .then((r) => r.json())
      .then((d) => {
        const count = d.meta?.kritis ?? 0;
        setKritisCount(count);
        sessionStorage.setItem(CACHE_KEY, String(count));
        sessionStorage.setItem(CACHE_TS, String(Date.now()));
      })
      .catch(() => {});
  }, []);

  const isDark = resolvedTheme === "dark";
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const isAegisActive        = pathname === "/aegis" || pathname.startsWith("/aegis/") || pathname === "/competitor";
  const isLoyaltyActive      = pathname === "/loyalty" || pathname.startsWith("/loyalty/");
  const isIntelligenceActive = pathname === "/executive-summary" || pathname === "/action-center" || pathname === "/report";

  const linkCls = (href: string) =>
    `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
      isActive(href)
        ? "bg-foreground/8 text-foreground dark:bg-white/10"
        : "text-muted-foreground hover:text-foreground hover:bg-foreground/5 dark:hover:bg-white/6"
    }`;

  const mobileLinkCls = (href: string) =>
    `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
      isActive(href)
        ? "bg-foreground/8 text-foreground dark:bg-white/10"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
    }`;

  const dropdownBtnCls = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
      active
        ? "bg-foreground/8 text-foreground dark:bg-white/10"
        : "text-muted-foreground hover:text-foreground hover:bg-foreground/5 dark:hover:bg-white/6"
    }`;

  const dropItemCls = (href: string) => {
    const currentTab = href.includes("?tab=") ? href.split("?tab=")[1] : null;
    const urlTab = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("tab")
      : null;
    const active = currentTab
      ? (pathname === "/loyalty" && urlTab === currentTab)
      : pathname === href || pathname.startsWith(href + "/");
    return active ? "font-semibold text-foreground" : "";
  };

  const aegisDropItemCls = (href: string) => {
    const active = pathname === href || (href !== "/aegis" && pathname.startsWith(href));
    return active ? "font-semibold text-foreground" : "";
  };

  const nav = (href: string) => {
    router.push(href);
    setMenuOpen(false);
    setLoyaltyOpen(false);
    setAegisOpen(false);
    setIntelligenceOpen(false);
  };

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 h-16 border-b border-border/60 bg-background/96 backdrop-blur-md supports-[backdrop-filter]:bg-background/80 shadow-sm">
        <div className="flex items-center h-full max-w-7xl mx-auto px-4 sm:px-6 gap-4 sm:gap-8">

          {/* Logo */}
          <div className="flex items-center gap-2.5 select-none shrink-0">
            <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
              <HugeiconsIcon icon={toIcon(AnalyticsIcon)} size={16} className="text-background" />
            </div>
            <span className="hidden sm:inline text-base font-semibold tracking-tight text-foreground">
              CORE Platform
            </span>
          </div>

          {/* Desktop nav: Home | AEGIS▾ | Loyalty▾ | ILP | Tracker | ORACLE | Intelligence▾ | Settings | About */}
          <nav className="hidden md:flex items-center gap-0.5">

            {/* Home */}
            <a href="/" className={linkCls("/")}>
              <HugeiconsIcon icon={toIcon(HomeIcon)} size={15} />
              Home
            </a>

            {/* AEGIS dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={dropdownBtnCls(isAegisActive)}>
                  <HugeiconsIcon icon={toIcon(AlertCircleIcon)} size={15} />
                  AEGIS
                  {openCount > 0 && (
                    <span className="ml-0.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold
                      bg-red-500 text-white flex items-center justify-center leading-none">
                      {openCount > 99 ? "99+" : openCount}
                    </span>
                  )}
                  <ChevronDown size={12} className="ml-0.5 opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {AEGIS_ITEMS.map((item) => (
                  <DropdownMenuItem
                    key={item.href}
                    onClick={() => nav(item.href)}
                    className={`text-sm cursor-pointer ${aegisDropItemCls(item.href)}`}
                  >
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Loyalty dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={dropdownBtnCls(isLoyaltyActive)}>
                  <HugeiconsIcon icon={toIcon(AwardIcon)} size={15} />
                  Loyalty
                  <ChevronDown size={12} className="ml-0.5 opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {LOYALTY_ITEMS.map((group, gi) => (
                  <div key={gi}>
                    {gi > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-widest px-2 py-1.5">
                      {group.label}
                    </DropdownMenuLabel>
                    {group.items.map((item) => (
                      <DropdownMenuItem
                        key={item.href}
                        onClick={() => nav(item.href)}
                        className={`text-sm cursor-pointer ${dropItemCls(item.href)}`}
                      >
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* ILP */}
            <a href="/ilp" className={linkCls("/ilp")}>
              <HugeiconsIcon icon={toIcon(BarChartIcon)} size={15} />
              ILP
            </a>

            {/* Tracker */}
            <a href="/performance" className={linkCls("/performance")}>
              <HugeiconsIcon icon={toIcon(ChartUpIcon)} size={15} />
              Tracker
            </a>

            {/* ORACLE */}
            <a href="/analytics/oracle" className={linkCls("/analytics/oracle")}>
              <Bot size={15} strokeWidth={1.75} />
              ORACLE
            </a>

            {/* Intelligence dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={dropdownBtnCls(isIntelligenceActive)}>
                  <Sparkles size={15} strokeWidth={1.75} />
                  Intelligence
                  {kritisCount > 0 && (
                    <span className="ml-0.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold
                      bg-red-500 text-white flex items-center justify-center leading-none">
                      {kritisCount > 99 ? "99+" : kritisCount}
                    </span>
                  )}
                  <ChevronDown size={12} className="ml-0.5 opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem
                  onClick={() => nav("/executive-summary")}
                  className={`text-sm cursor-pointer ${isActive("/executive-summary") ? "font-semibold text-foreground" : ""}`}
                >
                  <HugeiconsIcon icon={toIcon(AnalyticsIcon)} size={14} className="mr-2 shrink-0" />
                  Executive Summary
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => nav("/action-center")}
                  className={`text-sm cursor-pointer ${isActive("/action-center") ? "font-semibold text-foreground" : ""}`}
                >
                  <Zap size={14} strokeWidth={1.75} className="mr-2 shrink-0" />
                  Action Center
                  {kritisCount > 0 && (
                    <span className="ml-auto min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold
                      bg-red-500 text-white flex items-center justify-center leading-none">
                      {kritisCount > 99 ? "99+" : kritisCount}
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => nav("/report")}
                  className={`text-sm cursor-pointer ${isActive("/report") ? "font-semibold text-foreground" : ""}`}
                >
                  <FileText size={14} strokeWidth={1.75} className="mr-2 shrink-0" />
                  AI Report Generator
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Settings */}
            <a href="/settings" className={linkCls("/settings")}>
              <Settings size={15} strokeWidth={1.75} />
              Settings
            </a>

            {/* About */}
            <a href="/about" className={linkCls("/about")}>
              <Info size={15} strokeWidth={1.75} />
              About
            </a>
          </nav>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-1">
            {/* ORACLE notifications */}
            {mounted && user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Notifikasi ORACLE"
                    className="relative w-8 h-8 rounded-lg flex items-center justify-center
                      text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
                  >
                    <Bell size={16} strokeWidth={1.75} />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-destructive text-white text-[10px]
                        rounded-full h-4 w-4 flex items-center justify-center leading-none">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Notifikasi ORACLE</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {notifications.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">Belum ada notifikasi</div>
                  ) : (
                    notifications.slice(0, 8).map((n) => (
                      <DropdownMenuItem
                        key={n.id}
                        onClick={() => !n.is_read && markRead(n.id)}
                        className={`flex flex-col items-start gap-0.5 py-2 ${!n.is_read ? "bg-muted/50" : ""}`}
                      >
                        <div className="flex items-center gap-1.5 w-full">
                          <span className="text-xs">
                            {n.severity === "critical" ? "🔴" : n.severity === "warning" ? "⚠️" : "ℹ️"}
                          </span>
                          <span className="text-xs font-medium truncate">{n.title}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2">{n.summary}</p>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className="w-8 h-8 rounded-lg flex items-center justify-center
                text-muted-foreground hover:text-foreground hover:bg-muted
                transition-colors duration-150"
            >
              {mounted ? (
                isDark
                  ? <Sun size={16} strokeWidth={1.75} />
                  : <Moon size={16} strokeWidth={1.75} />
              ) : (
                <span className="w-4 h-4" />
              )}
            </button>

            {/* User info */}
            {mounted && user && (
              <>
                <div className="hidden md:flex items-center gap-2.5 pl-2 pr-1">
                  <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center text-[13px] font-bold text-background select-none">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex flex-col leading-tight gap-0.5">
                    <span className="text-sm font-medium text-foreground">{user.name}</span>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full self-start leading-none ${
                        user.role === "admin"
                          ? "bg-green-500/15 text-green-700 dark:text-green-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {ROLE_LABEL[user.role] ?? user.role}
                    </span>
                  </div>
                </div>
                <button
                  onClick={logout}
                  title="Logout"
                  className="hidden md:flex w-8 h-8 rounded-lg items-center justify-center
                    text-muted-foreground hover:text-destructive hover:bg-destructive/8
                    transition-colors duration-150"
                >
                  <LogOut size={15} strokeWidth={1.75} />
                </button>
              </>
            )}

            {/* Hamburger */}
            <button
              className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg
                text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
              onClick={() => setMenuOpen((p) => !p)}
              aria-label="Toggle menu"
            >
              {menuOpen ? <X size={18} strokeWidth={2} /> : <Menu size={18} strokeWidth={2} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden fixed inset-x-0 top-16 z-40 border-b border-border/60 bg-background/96 backdrop-blur-md shadow-lg max-h-[80vh] overflow-y-auto">
          <nav className="flex flex-col px-4 py-3 gap-0.5 max-w-7xl mx-auto">

            {/* Home */}
            <a href="/" onClick={() => setMenuOpen(false)} className={mobileLinkCls("/")}>
              <HugeiconsIcon icon={toIcon(HomeIcon)} size={16} />
              Home
            </a>

            {/* AEGIS mobile */}
            <div>
              <button
                onClick={() => setAegisOpen((p) => !p)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                  isAegisActive
                    ? "bg-foreground/8 text-foreground dark:bg-white/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <HugeiconsIcon icon={toIcon(AlertCircleIcon)} size={16} />
                  AEGIS
                  {openCount > 0 && (
                    <span className="ml-1 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold
                      bg-red-500 text-white flex items-center justify-center leading-none">
                      {openCount > 99 ? "99+" : openCount}
                    </span>
                  )}
                </span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${aegisOpen ? "rotate-180" : ""}`} />
              </button>
              {aegisOpen && (
                <div className="ml-6 mt-1 flex flex-col gap-0.5 border-l border-border pl-3">
                  {AEGIS_ITEMS.map((item) => (
                    <button
                      key={item.href}
                      onClick={() => nav(item.href)}
                      className="text-left px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-100"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Loyalty mobile */}
            <div>
              <button
                onClick={() => setLoyaltyOpen((p) => !p)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                  isLoyaltyActive
                    ? "bg-foreground/8 text-foreground dark:bg-white/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <HugeiconsIcon icon={toIcon(AwardIcon)} size={16} />
                  Loyalty
                </span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${loyaltyOpen ? "rotate-180" : ""}`} />
              </button>
              {loyaltyOpen && (
                <div className="ml-6 mt-1 flex flex-col gap-0.5 border-l border-border pl-3">
                  {LOYALTY_ITEMS.flatMap((g) => g.items).map((item) => (
                    <button
                      key={item.href}
                      onClick={() => nav(item.href)}
                      className="text-left px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-100"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ILP */}
            <a href="/ilp" onClick={() => setMenuOpen(false)} className={mobileLinkCls("/ilp")}>
              <HugeiconsIcon icon={toIcon(BarChartIcon)} size={16} />
              ILP
            </a>

            {/* Tracker */}
            <a href="/performance" onClick={() => setMenuOpen(false)} className={mobileLinkCls("/performance")}>
              <HugeiconsIcon icon={toIcon(ChartUpIcon)} size={16} />
              Tracker
            </a>

            {/* ORACLE */}
            <a href="/analytics/oracle" onClick={() => setMenuOpen(false)} className={mobileLinkCls("/analytics/oracle")}>
              <Bot size={16} strokeWidth={1.75} />
              ORACLE
            </a>

            {/* Intelligence mobile */}
            <div>
              <button
                onClick={() => setIntelligenceOpen((p) => !p)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                  isIntelligenceActive
                    ? "bg-foreground/8 text-foreground dark:bg-white/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Sparkles size={16} strokeWidth={1.75} />
                  Intelligence
                  {kritisCount > 0 && (
                    <span className="ml-1 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold
                      bg-red-500 text-white flex items-center justify-center leading-none">
                      {kritisCount > 99 ? "99+" : kritisCount}
                    </span>
                  )}
                </span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${intelligenceOpen ? "rotate-180" : ""}`} />
              </button>
              {intelligenceOpen && (
                <div className="ml-6 mt-1 flex flex-col gap-0.5 border-l border-border pl-3">
                  <button onClick={() => nav("/executive-summary")} className="text-left px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-100">
                    📊 Executive Summary
                  </button>
                  <button onClick={() => nav("/action-center")} className="flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-100">
                    ⚡ Action Center
                    {kritisCount > 0 && (
                      <span className="min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold
                        bg-red-500 text-white flex items-center justify-center leading-none">
                        {kritisCount > 99 ? "99+" : kritisCount}
                      </span>
                    )}
                  </button>
                  <button onClick={() => nav("/report")} className="text-left px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-100">
                    📄 AI Report Generator
                  </button>
                </div>
              )}
            </div>

            {/* Settings */}
            <a href="/settings" onClick={() => setMenuOpen(false)} className={mobileLinkCls("/settings")}>
              <Settings size={16} strokeWidth={1.75} />
              Settings
            </a>

            {/* About */}
            <a href="/about" onClick={() => setMenuOpen(false)} className={mobileLinkCls("/about")}>
              <Info size={16} strokeWidth={1.75} />
              About
            </a>

            {mounted && user && (
              <div className="mt-2 pt-3 border-t border-border flex items-center justify-between px-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center text-[13px] font-bold text-background select-none">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex flex-col leading-tight gap-0.5">
                    <span className="text-sm font-medium text-foreground">{user.name}</span>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full self-start leading-none ${
                        user.role === "admin"
                          ? "bg-green-500/15 text-green-700 dark:text-green-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {ROLE_LABEL[user.role] ?? user.role}
                    </span>
                  </div>
                </div>
                <button
                  onClick={logout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                    text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-colors duration-150"
                >
                  <LogOut size={14} strokeWidth={1.75} />
                  Logout
                </button>
              </div>
            )}
          </nav>
        </div>
      )}
    </>
  );
}
