'use client';

import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { fetchJson, startPolling } from '../lib/poll.ts';

/**
 * Data the server rendered, kept fresh by polling `url` while `delayFor` says something can still
 * change. Returns the setter too, so a form can put its own answer in straight away.
 */
export function usePolled<T>(
  initial: T,
  url: string,
  delayFor: (data: T) => number | null,
): [T, Dispatch<SetStateAction<T>>] {
  const [data, setData] = useState(initial);

  // A fresh render from the server, after a navigation or a refresh, wins.
  useEffect(() => {
    setData(initial);
  }, [initial]);

  useEffect(
    () =>
      startPolling({
        first: initial,
        load: (signal) => fetchJson<T>(url, signal),
        delayFor,
        onData: setData,
      }),
    [initial, url, delayFor],
  );

  return [data, setData];
}
