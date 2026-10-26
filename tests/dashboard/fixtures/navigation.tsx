import React, { useSyncExternalStore } from 'react';
declare global { interface Window { __historyCalls: { method: string; data: unknown; url: string }[] } }
const notify = () => dispatchEvent(new Event('fixture-navigation'));
for (const name of ['pushState', 'replaceState'] as const) {
    const original = history[name].bind(history);
    history[name] = (data: unknown, unused: string, url?: string | URL | null) => {
        window.__historyCalls.push({ method: name, data, url: String(url) });
        original(data, unused, url); notify();
    };
}
const subscribe = (fn: () => void) => {
    addEventListener('popstate', fn); addEventListener('fixture-navigation', fn);
    return () => { removeEventListener('popstate', fn); removeEventListener('fixture-navigation', fn); };
};
const snapshot = () => location.href;
export function usePathname() { useSyncExternalStore(subscribe, snapshot, snapshot); return location.pathname; }
export function useSearchParams() { useSyncExternalStore(subscribe, snapshot, snapshot); return new URLSearchParams(location.search); }
export function useParams() { return { orgId: '00000000-0000-0000-0000-000000000001' }; }
const router = { push: (url: string) => history.pushState(null, '', url), replace: (url: string) => history.replaceState(null, '', url), refresh: () => {} };
export function useRouter() { return router; }
export function Link({ href, children, onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return <a href={href} {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented) { event.preventDefault(); router.push(href); } }}>{children}</a>;
}
