// Two pages on one origin: the planner at "/" and the explainer at "/docs".
// Navigation uses the History API, so moving between them keeps the loaded fonts and code.
import { useCallback, useEffect, useRef, useState } from 'react';

export type Page = 'planner' | 'docs';

export function pageFromPath(path: string): Page {
  return path.replace(/\/+$/, '') === '/docs' ? 'docs' : 'planner';
}

export const pagePath = (p: Page) => (p === 'docs' ? '/docs' : '/');

export type Navigate = (page: Page, hash?: string) => void;

/** The planner's query string when we last left it, so coming back restores its settings and route. */
let plannerSearch = '';
/** Set by navigate(); the page that mounts next takes focus (see usePageFocus). */
let pendingFocus = false;

export function usePage(): [Page, Navigate] {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback<Navigate>((next, hash) => {
    if (pageFromPath(window.location.pathname) === 'planner') plannerSearch = window.location.search;
    const url = `${pagePath(next)}${next === 'planner' ? plannerSearch : ''}${hash ? `#${hash}` : ''}`;
    window.history.pushState(null, '', url);
    pendingFocus = true;
    setPage(next);
    if (!hash) window.scrollTo(0, 0);
  }, []);
  return [page, navigate];
}

/** After an in-app page switch, move keyboard focus to the new page's <main> and scroll to the hash, if any. */
export function usePageFocus(ready: boolean) {
  useEffect(() => {
    if (!pendingFocus) return;
    pendingFocus = false;
    document.getElementById('main')?.focus({ preventScroll: true });
  }, []);
  // a section link (/docs#limits): scroll on mount, and once more when the data first arrives and
  // changes the heights above it; later data (a city switch) must not pull the reader back
  const settled = useRef(false);
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id || settled.current) return;
    if (ready) settled.current = true;
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'instant' }), ready ? 120 : 60);
    return () => window.clearTimeout(t);
  }, [ready]);
}

/** The planner query string remembered by navigate(), for pages that want the planner's city. */
export const lastPlannerSearch = () => plannerSearch || (pageFromPath(window.location.pathname) === 'planner' ? window.location.search : '');
