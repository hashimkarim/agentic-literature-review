import { useCallback, useLayoutEffect, useRef, useState } from "react";

interface ReadingPosition {
  top: number;
  followLatest: boolean;
}

/** Preserve reading position per conversation, including while its tab is hidden. */
export function useChatScroll(scopeKey: string, contentVersion: string) {
  const positions = useRef(new Map<string, ReadingPosition>());
  const control = useRef<{ restore(): void; follow(): void } | null>(null);
  const [viewport, viewportRef] = useState<HTMLDivElement | null>(null);
  const [content, contentRef] = useState<HTMLDivElement | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);

  useLayoutEffect(() => {
    if (!viewport || !content) return;
    let position = positions.current.get(scopeKey);
    if (!position) {
      position = { top: 0, followLatest: true };
      positions.current.set(scopeKey, position);
    }
    const saved = position;
    let assignedTop: number | null = null;
    const maxTop = () => Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const restore = () => {
      viewport.scrollTop = saved.followLatest ? maxTop() : Math.min(saved.top, maxTop());
      assignedTop = viewport.scrollTop;
      setAwayFromLatest(!saved.followLatest && maxTop() - viewport.scrollTop > 48);
    };
    const onScroll = () => {
      // Programmatic restoration can be clamped while history is still loading.
      // Do not overwrite the saved position with that temporary scroll offset.
      if (assignedTop !== null && Math.abs(viewport.scrollTop - assignedTop) <= 1) {
        assignedTop = null;
        return;
      }
      assignedTop = null;
      saved.top = viewport.scrollTop;
      saved.followLatest = maxTop() - viewport.scrollTop <= 48;
      setAwayFromLatest(!saved.followLatest);
    };
    const current = {
      restore,
      follow: () => { saved.followLatest = true; restore(); }
    };
    control.current = current;
    viewport.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(restore);
    observer.observe(viewport);
    observer.observe(content);
    restore();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      if (control.current === current) control.current = null;
    };
  }, [viewport, content, scopeKey]);

  useLayoutEffect(() => { control.current?.restore(); }, [contentVersion]);
  const scrollToLatest = useCallback(() => { control.current?.follow(); }, []);
  return { viewportRef, contentRef, awayFromLatest, scrollToLatest };
}
