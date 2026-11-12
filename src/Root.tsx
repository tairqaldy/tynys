import { Suspense, lazy } from 'react';
import App from './App';
import { usePage } from './lib/route';

const DocsPage = lazy(() => import('./docs/DocsPage'));

export default function Root() {
  const [page, navigate] = usePage();
  if (page === 'docs') {
    return (
      <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
        <DocsPage navigate={navigate} />
      </Suspense>
    );
  }
  return <App navigate={navigate} />;
}
