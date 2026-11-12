// Two pages on one origin: the planner at "/" and the explainer at "/docs".
// Navigation uses the History API, so moving between them keeps the loaded fonts and code.
import { useCallback, useEffect, useState } from 'react';

export type Page = 'planner' | 'docs';

export function pageFromPath(path: string): Page {
  return path.replace(/\/+$/, '') === '/docs' ? 'docs' : 'planner';
}

export const pagePath = (p: Page) => (p === 'docs' ? '/docs' : '/');

export type Navigate = (page: Page, hash?: string) => void;

export function usePage(): [Page, Navigate] {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback<Navigate>((next, hash) => {
    const url = `${pagePath(next)}${next === 'planner' ? window.location.search : ''}${hash ? `#${hash}` : ''}`;
    window.history.pushState(null, '', url);
    setPage(next);
    requestAnimationFrame(() => {
      const el = hash ? document.getElementById(hash) : null;
      if (el) el.scrollIntoView();
      else window.scrollTo(0, 0);
    });
  }, []);
  return [page, navigate];
}
