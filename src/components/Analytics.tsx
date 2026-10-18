"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Envoie une page vue à chaque navigation. Exécuté seulement par de vrais navigateurs
 * (les robots qui n'exécutent pas le JavaScript ne sont donc jamais comptés).
 * Respecte « Do Not Track » et Global Privacy Control.
 */
export default function Analytics() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    // La page d'audience (propriétaire) n'est jamais comptée.
    if (last.current === pathname || pathname.startsWith("/stats")) return;
    const firstView = last.current === null;
    last.current = pathname;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
    const body = JSON.stringify({ path: pathname, referrer: firstView ? document.referrer || null : null });
    if (!navigator.sendBeacon?.("/api/hit", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/hit", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => undefined);
    }
  }, [pathname]);

  return null;
}
