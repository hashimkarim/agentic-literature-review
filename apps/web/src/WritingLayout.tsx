import { useEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical, MoreHorizontal } from "lucide-react";

export function WritingDivider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [stacked, setStacked] = useState(() => window.matchMedia("(max-width: 1100px)").matches);
  const drag = useRef<{ pointer: number; start: number; size: number; value: number } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const update = () => { drag.current = null; setStacked(media.matches); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const resize = (next: number) => onChange(Math.min(75, Math.max(25, Math.round(next))));
  return <div className="writing-divider" role="separator" tabIndex={0} aria-label="Resize source and PDF"
    aria-orientation={stacked ? "horizontal" : "vertical"} aria-valuemin={25} aria-valuemax={75} aria-valuenow={value} aria-valuetext={`${value}% source`}
    title="Resize source and PDF. Double-click to reset."
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
      drag.current = { pointer: event.pointerId, start: stacked ? event.clientY : event.clientX, size: (stacked ? bounds.height : bounds.width) - 6, value };
      event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); event.preventDefault();
    }}
    onPointerMove={(event) => {
      const start = drag.current;
      if (start && start.pointer === event.pointerId && start.size > 0) resize(start.value + ((stacked ? event.clientY : event.clientX) - start.start) / start.size * 100);
    }}
    onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { if (drag.current) onChange(drag.current.value); drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => onChange(50)}
    onKeyDown={(event) => {
      if (event.key === "Home" || event.key === "End") { event.preventDefault(); resize(event.key === "Home" ? 25 : 75); }
      else if (event.key === (stacked ? "ArrowUp" : "ArrowLeft")) { event.preventDefault(); resize(value - 2); }
      else if (event.key === (stacked ? "ArrowDown" : "ArrowRight")) { event.preventDefault(); resize(value + 2); }
    }}><GripVertical size={14} /></div>;
}

export function WritingActions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return <details className="writing-actions" ref={ref} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); ref.current!.open = false; ref.current?.querySelector("summary")?.focus(); }
  }}>
    <summary aria-label="More writing actions" title="More writing actions"><MoreHorizontal size={18} /></summary>
    <div aria-label="Writing actions" onClick={(event) => {
      if ((event.target as Element).closest("button:not(:disabled)")) ref.current!.open = false;
    }}>{children}</div>
  </details>;
}
