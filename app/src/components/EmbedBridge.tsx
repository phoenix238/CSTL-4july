"use client";

import { useEffect } from "react";

/**
 * Talks to the website when /book is shown inside its iframe.
 *
 * - Sends the page's height up, so the site can size the frame to fit and the
 *   frame itself never scrolls (the website's page scrolls instead).
 * - Receives which slice of the frame is actually on screen, as CSS variables
 *   (--vp-top, --vp-h). The booking form and toasts are `position: fixed`, and
 *   in a frame as tall as its content "fixed" means the whole frame, so without
 *   this they'd open centred somewhere off-screen. See Sheet / ToastProvider.
 *
 * The height and a "go to top" nudge are not sensitive, so they're posted to
 * any parent; the viewport numbers coming back are validated as plain numbers.
 */
export function EmbedBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    const root = document.documentElement;
    // globals.css sets html/body to height:100%, which inside a frame sized to
    // the content would just echo the frame's own height back. Let them shrink
    // to what's actually on the page.
    root.style.height = "auto";
    document.body.style.height = "auto";
    // The body's own box, not documentElement.scrollHeight: scrollHeight never
    // reports less than the frame's current height, so the frame could grow
    // but never shrink back (e.g. moving to a day with fewer times).
    const post = () =>
      window.parent.postMessage(
        { type: "cstl-book:height", height: Math.ceil(document.body.getBoundingClientRect().height) },
        "*",
      );
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);

    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; top?: unknown; height?: unknown };
      if (d?.type !== "cstl-book:viewport") return;
      if (typeof d.top !== "number" || typeof d.height !== "number" || !Number.isFinite(d.top + d.height)) return;
      root.style.setProperty("--vp-top", `${Math.max(0, d.top)}px`);
      root.style.setProperty("--vp-h", `${Math.max(200, d.height)}px`);
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "cstl-book:ready" }, "*");
    return () => {
      ro.disconnect();
      window.removeEventListener("message", onMessage);
    };
  }, []);
  return null;
}

/** Ask the website to scroll the frame's top to just under its menu bar (opening the form, after booking). */
export function scrollEmbedToTop() {
  if (typeof window !== "undefined" && window.parent !== window) {
    window.parent.postMessage({ type: "cstl-book:top" }, "*");
  }
}
