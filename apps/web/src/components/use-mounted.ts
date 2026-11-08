'use client';

import { useEffect, useState } from 'react';

/**
 * False on the server and in the browser's first render, true after. A time or a countdown renders
 * in the server's clock first, then in the viewer's own. Give the element `key={mounted ? 'local' :
 * 'server'}` so React replaces it: with `suppressHydrationWarning` alone, React 19 keeps the
 * server's text for good.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
