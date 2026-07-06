"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../ui";
import type { SpanDTO } from "./layout";

/**
 * Fetch busy spans for a window starting at `start`, cached per window so
 * paging back and forth between weeks/months is instant. `invalidate()` after
 * booking/cancelling/rescheduling.
 */
export function useWeekSpans(start: Date, days = 7) {
  const cache = useRef(new Map<string, SpanDTO[]>());
  const [spans, setSpans] = useState<SpanDTO[] | null>(null);
  const [version, setVersion] = useState(0);
  const key = `${start.toISOString()}·${days}`;

  useEffect(() => {
    const cached = cache.current.get(key);
    if (cached) {
      setSpans(cached);
      return;
    }
    let stale = false;
    setSpans(null);
    api<{ spans: SpanDTO[] }>(`/api/availability?start=${encodeURIComponent(start.toISOString())}&days=${days}`)
      .then(({ spans: s }) => {
        cache.current.set(key, s);
        if (!stale) setSpans(s);
      })
      .catch(() => {
        if (!stale) setSpans([]);
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const invalidate = useCallback(() => {
    cache.current.clear();
    setVersion((v) => v + 1);
  }, []);

  return { spans, invalidate };
}
