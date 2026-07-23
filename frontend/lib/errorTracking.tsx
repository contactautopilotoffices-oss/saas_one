/**
 * Automatic Error Tracking System
 * Captures UI errors, API errors, and user feedback automatically
 */

import { createClient } from '@/frontend/utils/supabase/client';

interface ErrorContext {
  userId?: string;
  propertyId?: string;
  organizationId?: string;
  page?: string;
  component?: string;
}

interface ErrorPayload {
  category: 'ui_error' | 'api_error' | 'db_error' | 'performance' | 'ux_friction';
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: 'frontend';
  error_message: string;
  error_code?: string;
  stack_trace?: string;
  page_url?: string;
  page_route?: string;
  component_name?: string;
  user_agent?: string;
  browser?: string;
  os?: string;
  device?: string;
  screen_size?: string;
  user_id?: string;
  property_id?: string;
  organization_id?: string;
  occurred_at: string;
}

interface UserFeedbackPayload {
  category: 'user_feedback';
  severity: 'medium';
  source: 'frontend';
  error_message: string;
  user_description: string;
  user_screenshot_url?: string;
  page_url?: string;
  page_route?: string;
  user_agent?: string;
  browser?: string;
  os?: string;
  device?: string;
  screen_size?: string;
  user_id?: string;
  property_id?: string;
  organization_id?: string;
  occurred_at: string;
}

// Parse user agent for browser/OS info
function parseUserAgent(ua: string): { browser: string; os: string; device: string } {
  const isMobile = /mobile|android|iphone|ipad/i.test(ua);
  const browser = ua.includes('Chrome') ? 'Chrome' :
                  ua.includes('Firefox') ? 'Firefox' :
                  ua.includes('Safari') ? 'Safari' : 'Other';
  const os = ua.includes('Windows') ? 'Windows' :
             ua.includes('Mac') ? 'macOS' :
             ua.includes('Android') ? 'Android' :
             ua.includes('iOS') ? 'iOS' : 'Other';
  const device = isMobile ? 'Mobile' : 'Desktop';
  return { browser, os, device };
}

// Send error to backend (silent - no user impact)
async function captureError(payload: ErrorPayload | UserFeedbackPayload) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Add user context if available
    if (user && !payload.user_id) {
      payload.user_id = user.id;
    }

    // Get current page context
    if (typeof window !== 'undefined') {
      payload.page_url = window.location.href;
      payload.page_route = window.location.pathname;
      const { browser, os, device } = parseUserAgent(navigator.userAgent);
      payload.user_agent = navigator.userAgent;
      payload.browser = browser;
      payload.os = os;
      payload.device = device;
      payload.screen_size = `${window.screen.width}x${window.screen.height}`;
    }

    // Send to API (non-blocking)
    fetch('/api/internal/issue-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Silent fail - never impact user
    });
  } catch {
    // Silent fail
  }
}

// ============================================================
// 1. GLOBAL ERROR HANDLERS (Run once on app init)
// ============================================================

export function initErrorTracking(context: ErrorContext = {}) {
  if (typeof window === 'undefined') return;

  // Store context for all errors
  (window as any).__errorContext = context;

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    if (error instanceof Error) {
      captureError({
        category: 'api_error',
        severity: 'high',
        source: 'frontend',
        error_message: error.message,
        stack_trace: error.stack,
        occurred_at: new Date().toISOString(),
        ...context,
      });
    }
  });

  // Capture uncaught errors
  window.addEventListener('error', (event) => {
    captureError({
      category: 'ui_error',
      severity: 'high',
      source: 'frontend',
      error_message: event.message,
      stack_trace: event.error?.stack,
      occurred_at: new Date().toISOString(),
      ...context,
    });
  });
}

// ============================================================
// 2. API RESPONSE INTERCEPTOR (Automatic API error capture)
// ============================================================

export function setupApiInterceptor() {
  if (typeof window === 'undefined') return;

  const originalFetch = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startTime = Date.now();

    try {
      const response = await originalFetch(input, init);
      const duration = Date.now() - startTime;

      // Capture API errors (4xx, 5xx) - Ignore the issue tracker itself to prevent infinite loops
      const urlString = input instanceof Request ? input.url : String(input);
      if (!response.ok && !urlString.includes('/api/internal/issue-logs')) {
        let errorBody: { error?: string } = {};
        try {
          errorBody = await response.clone().json();
        } catch {}

        // Determine severity
        let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
        if (response.status >= 500) severity = 'high';
        if (response.status >= 500 && response.statusText?.includes('timeout')) {
          severity = 'critical';
        }

        captureError({
          category: 'api_error',
          severity,
          source: 'frontend',
          error_message: errorBody?.error || `HTTP ${response.status}: ${response.statusText}`,
          error_code: String(response.status),
          request_url: input instanceof Request ? input.url : String(input),
          request_method: init?.method || 'GET',
          request_body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
          occurred_at: new Date().toISOString(),
          ...(window as any).__errorContext,
        });
      }

      // Capture slow API responses (>3 seconds)
      if (duration > 3000) {
        captureError({
          category: 'performance',
          severity: 'medium',
          source: 'frontend',
          error_message: `Slow API response: ${duration}ms`,
          request_url: input instanceof Request ? input.url : String(input),
          request_method: init?.method || 'GET',
          occurred_at: new Date().toISOString(),
          ...(window as any).__errorContext,
        });
      }

      return response;
    } catch (error: any) {
      // Network errors
      // Network errors - Ignore the issue tracker itself
      const urlString = input instanceof Request ? input.url : String(input);
      if (!urlString.includes('/api/internal/issue-logs')) {
        captureError({
          category: 'api_error',
          severity: 'high',
          source: 'frontend',
          error_message: error.message || 'Network error',
          request_url: urlString,
          request_method: init?.method || 'GET',
          occurred_at: new Date().toISOString(),
          ...(window as any).__errorContext,
        });
      }
      throw error;
    }
  };
}

// ============================================================
// 3. REACT ERROR BOUNDARY (Component crash capture)
// ============================================================

import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const componentStack = errorInfo.componentStack?.split('\n')[1]?.trim() || 'Unknown';

    captureError({
      category: 'ui_error',
      severity: 'critical',
      source: 'frontend',
      error_message: error.message,
      stack_trace: errorInfo.componentStack,
      component_name: componentStack,
      occurred_at: new Date().toISOString(),
      ...(window as any).__errorContext,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-gray-600 mb-4">We're working on fixing this issue.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================
// 4. PERFORMANCE MONITORING
// ============================================================

export function initPerformanceMonitoring() {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return;

  // Monitor slow page loads
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'navigation') {
        const nav = entry as PerformanceNavigationTiming;
        const loadTime = nav.loadEventEnd - nav.requestStart;

        if (loadTime > 5000) {
          captureError({
            category: 'performance',
            severity: 'medium',
            source: 'frontend',
            error_message: `Slow page load: ${Math.round(loadTime)}ms`,
            page_url: window.location.href,
            page_route: window.location.pathname,
            occurred_at: new Date().toISOString(),
            ...(window as any).__errorContext,
          });
        }
      }
    }
  });

  try {
    observer.observe({ entryTypes: ['navigation'] });
  } catch {
    // Silent fail
  }
}

// ============================================================
// 5. USER FEEDBACK (Manual issue report)
// ============================================================

export async function submitUserFeedback(
  description: string,
  screenshotUrl?: string
): Promise<boolean> {
  try {
    await captureError({
      category: 'user_feedback',
      severity: 'medium',
      source: 'frontend',
      error_message: 'User reported issue',
      user_description: description,
      user_screenshot_url: screenshotUrl,
      page_url: typeof window !== 'undefined' ? window.location.href : undefined,
      page_route: typeof window !== 'undefined' ? window.location.pathname : undefined,
      occurred_at: new Date().toISOString(),
      ...(window as any).__errorContext,
    });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// 6. INITIALIZE ALL TRACKING
// ============================================================

export function initIssueTracking(context: ErrorContext = {}) {
  initErrorTracking(context);
  setupApiInterceptor();
  initPerformanceMonitoring();
}
