import React from 'react';
import { createRoot } from 'react-dom/client';
import PettyCashDashboard from '../../../frontend/components/pettyCash/PettyCashDashboard';
import PettyCashNavLink from '../../../frontend/components/pettyCash/PettyCashNavLink';
const originalFetch = window.fetch.bind(window);
window.fetch = (url, options) => { const headers = new Headers(options?.headers); headers.set('x-fixture-actor', new URLSearchParams(location.search).get('actor') || '11'); return originalFetch(url, { ...options, headers }); };
createRoot(document.getElementById('root')!).render(<><aside className="hidden lg:block fixed inset-y-0 left-0 z-40 w-72 bg-surface border-r border-border"><PettyCashNavLink /></aside><main className="relative z-10 lg:ml-72 p-4"><PettyCashDashboard /></main></>);
