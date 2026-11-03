/**
 * Candidate Search: the one typed fetch helper the tab uses. Every route answers errors as `{ error: string }` with an
 * HTTP status (see backend/lib/candidates/types.ts and app/api/candidates). This never throws: callers branch on `ok`.
 */

export const NO_ACCESS_MESSAGE = "You don't have access to Candidate Search.";
const NETWORK_MESSAGE = 'Could not reach the server. Please check the connection and try again.';

export type ApiResult<T> =
    | { ok: true; status: number; data: T }
    | {
          ok: false;
          status: number;
          error: string;
          /** The parsed JSON body, kept so a caller can read a structured 409 (e.g. UploadConflict). */
          body: unknown;
          noAccess: boolean;
          aborted: boolean;
      };

export type ApiFailure = Extract<ApiResult<unknown>, { ok: false }>;

interface ApiInit {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    /** Sent as a JSON body. */
    json?: unknown;
    /** Sent as multipart/form-data (the browser sets the boundary header). */
    form?: FormData;
    signal?: AbortSignal;
}

/** Builds `?a=1&b=2`, dropping empty / null / undefined / false values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === null || v === undefined || v === '' || v === false) continue;
        sp.set(k, v === true ? '1' : String(v));
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<ApiResult<T>> {
    const method = init.method ?? (init.json !== undefined || init.form ? 'POST' : 'GET');
    let res: Response;
    try {
        res = await fetch(path, {
            method,
            cache: 'no-store',
            signal: init.signal,
            headers: init.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
            body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
        });
    } catch (e) {
        const aborted = e instanceof DOMException && e.name === 'AbortError';
        return { ok: false, status: 0, error: aborted ? 'Cancelled' : NETWORK_MESSAGE, body: null, noAccess: false, aborted };
    }

    const body: unknown = await res.json().catch(() => null);
    return resultFrom<T>(res.status, body);
}

function resultFrom<T>(status: number, body: unknown): ApiResult<T> {
    if (status >= 200 && status < 300) return { ok: true, status, data: body as T };
    const res = { status };

    const serverError =
        body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : '';
    const noAccess = res.status === 401 || res.status === 403;
    const error = noAccess
        ? NO_ACCESS_MESSAGE
        : serverError ||
          (res.status === 429
              ? 'Too many requests. Please wait a moment and try again.'
              : `Something went wrong (error ${res.status}). Please try again.`);
    return { ok: false, status: res.status, error, body, noAccess, aborted: false };
}

/**
 * POST a multipart form and report how much of it has been sent (0-1), for the upload progress bar. fetch() cannot
 * report upload progress, so this one uses XMLHttpRequest. `onSent` fires when the file is fully sent and the server is
 * working on it. Same result shape as api(); never throws.
 */
export function apiUpload<T>(path: string, form: FormData, onProgress: (fraction: number) => void, onSent?: () => void): Promise<ApiResult<T>> {
    return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', path);
        xhr.responseType = 'text';
        xhr.upload.onprogress = e => { if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total)); };
        xhr.upload.onload = () => { onProgress(1); onSent?.(); };
        xhr.onload = () => {
            let body: unknown = null;
            try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { body = null; }
            resolve(resultFrom<T>(xhr.status, body));
        };
        xhr.onerror = () => resolve({ ok: false, status: 0, error: NETWORK_MESSAGE, body: null, noAccess: false, aborted: false });
        xhr.onabort = () => resolve({ ok: false, status: 0, error: 'Cancelled', body: null, noAccess: false, aborted: true });
        xhr.send(form);
    });
}
