"use client";

import { useEffect } from "react";

/** Sets a data attribute once React has hydrated - used by the E2E suite for deterministic waits. */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.setAttribute("data-hydrated", "true");
  }, []);
  return null;
}
