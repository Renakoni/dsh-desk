import { useEffect, useRef, useState } from "react";

export function useVirtualRows<T>(items: T[], rowHeight: number, resetKey: string, overscan = 5) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(420);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const update = () => setViewportHeight(viewport.clientHeight || 420);
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);
  return {
    viewportRef,
    onScroll: (scrollTopValue: number) => setScrollTop(scrollTopValue),
    totalHeight: items.length * rowHeight,
    start,
    visible: items.slice(start, end)
  };
}
