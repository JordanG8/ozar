"use client";

import { useEffect } from "react";

function editing() {
  const element = document.activeElement;
  return element instanceof HTMLElement && (element.isContentEditable ||
    (element instanceof HTMLInputElement && !["button", "checkbox", "radio", "range", "submit"].includes(element.type)) ||
    element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement);
}

// Fits the page to the space above the on-screen keyboard. Android resizes the layout itself
// (interactive-widget=resizes-content). iOS only shrinks the visual viewport and scrolls the page,
// so the visible height goes into --keyboard-viewport and the page is pinned back to the top.
export function KeyboardViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let width = viewport.width;
    let full = viewport.height;
    let frame = 0;

    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!viewport) return;
        if (Math.abs(viewport.width - width) > 1) {
          width = viewport.width;
          full = viewport.height;
        }
        const open = editing() && full - viewport.height > 120;
        if (!open) full = Math.max(full, viewport.height);
        if (open) {
          root.dataset.keyboard = "open";
          root.style.setProperty("--keyboard-viewport", `${viewport.height}px`);
          if (window.scrollY) window.scrollTo(0, 0);
        } else if (root.dataset.keyboard) {
          delete root.dataset.keyboard;
          root.style.removeProperty("--keyboard-viewport");
        }
      });
    }

    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      delete root.dataset.keyboard;
      root.style.removeProperty("--keyboard-viewport");
    };
  }, []);
  return null;
}
