"use client";

import { useEffect } from "react";

/**
 * Trackpad pinch (wheel + ctrlKey) and Safari gesture events otherwise zoom
 * the whole browser when the cursor sits on a panel over the map.
 */
export function useLockPageZoom(active = true) {
  useEffect(() => {
    if (!active) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault();
    const opts: AddEventListenerOptions = { passive: false };
    document.addEventListener("wheel", onWheel, opts);
    document.addEventListener("gesturestart", onGesture, opts);
    document.addEventListener("gesturechange", onGesture, opts);
    document.addEventListener("gestureend", onGesture, opts);
    return () => {
      document.removeEventListener("wheel", onWheel, opts);
      document.removeEventListener("gesturestart", onGesture, opts);
      document.removeEventListener("gesturechange", onGesture, opts);
      document.removeEventListener("gestureend", onGesture, opts);
    };
  }, [active]);
}
