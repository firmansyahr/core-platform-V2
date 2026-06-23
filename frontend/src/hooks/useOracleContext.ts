"use client";

import { useEffect } from "react";
import { usePathname, useParams } from "next/navigation";
import { useOracleContextValue, type PageContextData } from "@/components/oracle/OracleContextProvider";

function detectModule(pathname: string): string | null {
  if (pathname.startsWith("/loyalty/promo")) return "promo";
  if (pathname.startsWith("/loyalty")) return "loyalty";
  if (pathname.startsWith("/aegis")) return "aegis";
  if (pathname.startsWith("/ilp")) return "ilp";
  if (pathname.startsWith("/competitor")) return "competitor";
  if (pathname.startsWith("/performance")) return "performance";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/report")) return "report";
  if (pathname === "/") return "home";
  return null;
}

function detectEntityType(pathname: string): string | null {
  if (pathname.startsWith("/loyalty/promo/") && pathname !== "/loyalty/promo") return "promo";
  if (pathname.startsWith("/aegis/store/")) return "toko";
  if (pathname.startsWith("/aegis/cad-history/")) return "cad_alert";
  return null;
}

/**
 * Hook untuk halaman yang ingin memberi context ke ORACLE.
 * Auto-detect module/entity_type dari pathname; entity_id dari route params.
 * Pemanggilan setOracleContext({entity_name, entity_snapshot}) — biasanya di
 * dalam useEffect saat data entity (mis. promo/toko) sudah selesai di-fetch.
 */
export function useOracleContext() {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const { pageContext, setOracleContext, setPageMeta } = useOracleContextValue();

  const moduleName = detectModule(pathname);
  const entityType = detectEntityType(pathname);
  const entityIdFromRoute = params?.id ?? null;

  useEffect(() => {
    setPageMeta(pathname, moduleName);
    if (entityIdFromRoute) {
      setOracleContext({ entity_type: entityType, entity_id: entityIdFromRoute });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return {
    pageContext,
    setOracleContext,
  } as { pageContext: PageContextData; setOracleContext: typeof setOracleContext };
}
