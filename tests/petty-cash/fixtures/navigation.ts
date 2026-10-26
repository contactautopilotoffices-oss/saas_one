import {useSyncExternalStore} from 'react';
export function useParams<T = { orgId: string }>(): T { return { orgId: '00000000-0000-0000-0000-000000000001' } as T; }
export function usePathname() { return window.location.pathname; }

export function useSearchParams(){const search=useSyncExternalStore(callback=>{window.addEventListener('popstate',callback);return()=>window.removeEventListener('popstate',callback);},()=>window.location.search);return new URLSearchParams(search);}
export function useRouter(){return {replace:(href:string)=>{history.replaceState(null,'',href);window.dispatchEvent(new PopStateEvent('popstate'));}};}
