/**
 * Rewrites raw Supabase storage public URLs into secure local proxy paths
 * so external Supabase project URLs and bucket names are never exposed in the browser
 * or when users open images in a new tab.
 */
export function maskStorageUrl(url: string | null | undefined): string {
    if (!url) return '';
    if (typeof url !== 'string') return '';
    
    // Check if it's a Supabase storage URL (public or signed)
    const match = url.match(/https?:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?#]+)/);
    if (match) {
        const bucket = match[1];
        const path = match[2];
        return `/api/storage/${bucket}/${path}`;
    }

    return url;
}
