"use client";

import React, { useEffect, useRef } from "react";

export function InfiniteTableFooter({
  nextOffset,
  status,
  error = null,
  loadMore,
  columnCount,
}: {
  nextOffset: number | null;
  status: "idle" | "loading" | "error";
  error?: string | null;
  loadMore(): void;
  columnCount: number;
}): React.ReactElement | null {
  const footerRef = useRef<HTMLTableSectionElement>(null);
  const latchedRef = useRef(false);
  const currentRef = useRef({ status, error, loadMore });
  currentRef.current = { status, error, loadMore };

  const trigger = () => {
    const current = currentRef.current;
    if (latchedRef.current || current.status === "loading") return;
    latchedRef.current = true;
    current.loadMore();
  };

  useEffect(() => {
    if (status !== "loading") latchedRef.current = false;
  }, [nextOffset, status, error]);

  useEffect(() => {
    const footer = footerRef.current;
    if (
      !footer || status !== "idle" || error || typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    let active = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const current = currentRef.current;
        if (active && entry?.isIntersecting && current.status === "idle" && !current.error) {
          trigger();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(footer);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [nextOffset, status, error]);

  if (nextOffset === null) return null;

  return (
    <tfoot className="infinite-table-footer" ref={footerRef}>
      <tr>
        <td colSpan={columnCount}>
          {status === "loading" ? (
            <span role="status">Loading more…</span>
          ) : (
            <>
              {error ? <span role="alert">{error}</span> : null}
              <button type="button" onClick={trigger}>
                {status === "error" || error ? "Retry" : "Load more"}
              </button>
            </>
          )}
        </td>
      </tr>
    </tfoot>
  );
}
