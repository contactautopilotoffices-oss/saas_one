import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Security headers for production hardening
 * These protect against common web vulnerabilities
 */
const securityHeaders = {
    // Prevent clickjacking attacks
    'X-Frame-Options': 'DENY',
    // Prevent MIME type sniffing
    'X-Content-Type-Options': 'nosniff',
    // Enable XSS filtering in older browsers
    'X-XSS-Protection': '1; mode=block',
    // Control referrer information
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Restrict browser features/APIs
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
    // HTTP Strict Transport Security (enable in production with HTTPS)
    ...(process.env.NODE_ENV === 'production' ? {
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
    } : {}),
    // Content Security Policy - adjust based on your needs
    'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        `img-src 'self' data: blob: ${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('https://', 'https://') || 'https://*.supabase.co'} https://images.unsplash.com https://loremflickr.com https://placehold.co https://*.githubusercontent.com https://*.googleusercontent.com https://lh3.googleusercontent.com`,
        `media-src 'self' blob: ${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('https://', 'https://') || 'https://*.supabase.co'}`,
        "font-src 'self' data: https://fonts.gstatic.com",
        // api.openai.com: the council 1:1 voice call opens its WebRTC leg from
        // the browser with a server-minted ephemeral secret (never the API key).
        // *.livekit.cloud: meeting rooms (signalling over wss, region lookup over https).
        // LIVEKIT_URL is added too, so a self-hosted LiveKit works without editing this line.
        `connect-src 'self' http://localhost:3000 ws://localhost:3000 wss://*.livekit.cloud https://*.livekit.cloud ${process.env.LIVEKIT_URL ? `${process.env.LIVEKIT_URL} ${process.env.LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')}` : ''} ${process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://*.supabase.co'} ${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('https://', 'wss://') || 'wss://*.supabase.co'} https://www.gstatic.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://*.firebaseio.com https://api.openai.com https://api.plivo.com https://api.elevenlabs.io wss://api.elevenlabs.io`,
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join('; '),
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DASHBOARD_MODULES = new Set([
    'accounts',
    'ai-tickets',
    'aop',
    'book-room',
    'crm',
    'flow-map',
    'hr-assistant',
    'hr-tickets',
    'meera',
    'meetings',
    'org-efficiency',
    'org-progress',
    'petty-cash',
    'procurement-management',
    'properties',
    'rooms',
    'satej',
    'settings',
    'users',
]);

function applySecurityHeaders(res: NextResponse): NextResponse {
    Object.entries(securityHeaders).forEach(([key, value]) => {
        res.headers.set(key, value);
    });
    return res;
}

export async function proxy(request: NextRequest) {
    const pathname = request.nextUrl.pathname

    const isClientRsc = request.headers.get('rsc') === '1' || request.headers.has('next-router-state-tree');

    // 0. Handle legacy /org/<uuid>/dashboard or /<uuid>/dashboard bookmarks -> /dashboard
    if (
        /^\/org\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/dashboard(\/.*)?$/i.test(pathname) ||
        /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/dashboard(\/.*)?$/i.test(pathname)
    ) {
        if (isClientRsc) {
            const rewriteUrl = request.nextUrl.clone();
            rewriteUrl.pathname = '/dashboard';
            return applySecurityHeaders(NextResponse.rewrite(rewriteUrl, { request }));
        }
        const url = request.nextUrl.clone();
        url.pathname = '/dashboard';
        return applySecurityHeaders(NextResponse.redirect(url, 307));
    }

    // Handle legacy /org/<uuid>/<module> bookmarks -> /<module>
    const orgPrefixMatch = pathname.match(/^\/org\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/.*)?$/i);
    if (orgPrefixMatch) {
        const orgId = orgPrefixMatch[1];
        const rest = orgPrefixMatch[2] || '';
        if (isClientRsc) {
            const rewriteUrl = request.nextUrl.clone();
            rewriteUrl.pathname = rest ? rest : '/dashboard';
            const rewriteRes = NextResponse.rewrite(rewriteUrl, { request });
            rewriteRes.cookies.set('saas_org_id', orgId, { path: '/', maxAge: 2592000, sameSite: 'lax' });
            return applySecurityHeaders(rewriteRes);
        }
        const url = request.nextUrl.clone();
        url.pathname = rest ? rest : '/dashboard';
        const redirectRes = NextResponse.redirect(url, 307);
        redirectRes.cookies.set('saas_org_id', orgId, { path: '/', maxAge: 2592000, sameSite: 'lax' });
        return applySecurityHeaders(redirectRes);
    }

    // Handle legacy /<uuid>/<module> bookmarks -> redirect to clean /<module>
    const pathSegments = pathname.split('/').filter(Boolean);
    if (pathSegments.length >= 1 && UUID_REGEX.test(pathSegments[0])) {
        const orgId = pathSegments[0];
        const moduleName = pathSegments[1];
        if (moduleName && DASHBOARD_MODULES.has(moduleName)) {
            const rest = '/' + pathSegments.slice(1).join('/');
            if (isClientRsc) {
                const rewriteUrl = request.nextUrl.clone();
                rewriteUrl.pathname = rest;
                const rewriteRes = NextResponse.rewrite(rewriteUrl, { request });
                rewriteRes.cookies.set('saas_org_id', orgId, { path: '/', maxAge: 2592000, sameSite: 'lax' });
                return applySecurityHeaders(rewriteRes);
            }
            const url = request.nextUrl.clone();
            url.pathname = rest;
            const redirectRes = NextResponse.redirect(url, 307);
            redirectRes.cookies.set('saas_org_id', orgId, { path: '/', maxAge: 2592000, sameSite: 'lax' });
            return applySecurityHeaders(redirectRes);
        }
    }

    // Define public routes that don't require authentication
    const publicRoutes = [
        '/login',
        '/signup',
        '/forgot-password',
        '/reset-password',
        '/join',
        '/q',          // Public QR code entry points
        '/a/',         // Public asset QR scan page. Keep the trailing slash: the check is
                       // startsWith, and a bare '/a' would also unlock /<orgId>/... for any
                       // org id beginning with "a".
        '/t/',         // Public proctored-test links (/t/<token>) — no sign-in by design
        '/api',        // API routes handle their own auth
        '/kiosk',
        '/onboard',    // Public client onboarding QR route
        '/onboarding', // Has its own client-side auth check
        '/_next',
        '/favicon.ico',
        '/manifest.json', // Allow manifest file for PWA
        '/firebase-messaging-sw.js', // Allow service worker
        '/landing_animation', // Public landing animation page
        '/cc-preview', // TEMP: command-center design verification routes, removed after the revamp lands
        '/privacy',
        '/privacy-policy',
        '/terms',
    ]

    // Check if current path is public
    const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route)) || pathname === '/'

    // Create response
    let response = NextResponse.next()

    // Apply security headers to all responses
    Object.entries(securityHeaders).forEach(([key, value]) => {
        response.headers.set(key, value)
    })

    // 1. PUBLIC ROUTES: Bail out immediately to save overhead
    if (isPublicRoute && pathname !== '/login' && pathname !== '/signup') {
        return response
    }

    // 2. SUPABASE INITIALIZATION: Only happens for protected or auth routes
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    // If missing env vars, don't crash, just proceed
    if (!supabaseUrl || !supabaseAnonKey) {
        return response
    }

    const supabase = createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
            cookies: {
                getAll() { return request.cookies.getAll() },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        request.cookies.set(name, value)
                    })
                    response = NextResponse.next({ request })
                    Object.entries(securityHeaders).forEach(([key, value]) => {
                        response.headers.set(key, value)
                    })
                    cookiesToSet.forEach(({ name, value, options }) => {
                        response.cookies.set(name, value, options)
                    })
                },
            },
        }
    )

    // 3. AUTH CHECK: getUser is more secure than getSession on the server
    const { data: { user } } = await supabase.auth.getUser()

    // Redirect to login if user is not authenticated on a protected route
    if (!isPublicRoute && !user) {
        if (pathname.startsWith('/api')) {
            console.warn('Middleware: Unauthorized API request, but NOT redirecting:', pathname);
            return response; // Let the API handle its own 401
        }
        console.log('Middleware: Redirecting to login from:', pathname);
        const loginUrl = new URL('/login', request.url)
        const fullPath = request.nextUrl.pathname + request.nextUrl.search
        loginUrl.searchParams.set('redirect', fullPath)
        return NextResponse.redirect(loginUrl)
    }

    // If user is authenticated and tries to access login/signup, redirect to home
    if (user && (pathname === '/login' || pathname === '/signup')) {
        const mode = request.nextUrl.searchParams.get('mode')
        if (!mode) {
            return NextResponse.redirect(new URL('/', request.url))
        }
    }

    // 4. Clean dashboard sub-module rewrites for authenticated users
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length >= 1 && DASHBOARD_MODULES.has(segments[0])) {
        let orgId = request.cookies.get('saas_org_id')?.value;
        if (!orgId && user) {
            const { data: membership } = await supabase
                .from('organization_memberships')
                .select('organization_id')
                .eq('user_id', user.id)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();

            if (membership?.organization_id) {
                orgId = membership.organization_id;
            }
        }

        if (orgId) {
            const rewriteUrl = new URL(`/${orgId}${pathname}${request.nextUrl.search}`, request.url);
            const rewriteResponse = applySecurityHeaders(NextResponse.rewrite(rewriteUrl, { request }));
            rewriteResponse.cookies.set('saas_org_id', orgId, { path: '/', maxAge: 2592000, sameSite: 'lax' });
            return rewriteResponse;
        }
    }

    return response
}

export default proxy

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico, manifest.json, sw.js (essential static files)
         * - api routes (each handles its own auth - adding middleware here adds ~200-500ms per request)
         * - public folder files
         */
        '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|firebase-messaging-sw.js|/api/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json|webmanifest)$).*)',
    ],
}
