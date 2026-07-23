/**
 * Production-safe logger
 * Only logs in development, prevents sensitive data exposure in production
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const isDevelopment = process.env.NODE_ENV !== 'production'

/**
 * Sanitize data to prevent sensitive information from being logged
 */
function sanitize(data: unknown): unknown {
    if (data === null || data === undefined) return data
    if (typeof data !== 'object') return data

    const sensitiveKeys = [
        'password', 'secret', 'token', 'key', 'authorization',
        'cookie', 'session', 'credential', 'api_key', 'apikey',
        'service_role', 'anon_key', 'temp_password'
    ]

    if (Array.isArray(data)) {
        return data.map(item => sanitize(item))
    }

    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase()
        if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
            sanitized[key] = '[REDACTED]'
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitize(value)
        } else {
            sanitized[key] = value
        }
    }
    return sanitized
}

/**
 * Format log message with timestamp
 */
function formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString()
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`
    if (data !== undefined) {
        return `${prefix} ${message} ${JSON.stringify(sanitize(data))}`
    }
    return `${prefix} ${message}`
}

export const logger = {
    /**
     * Debug logs - only in development
     */
    debug(message: string, data?: unknown): void {
        if (isDevelopment) {
            console.log(formatMessage('debug', message, data))
        }
    },

    /**
     * Info logs - only in development
     */
    info(message: string, data?: unknown): void {
        if (isDevelopment) {
            console.info(formatMessage('info', message, data))
        }
    },

    /**
     * Warning logs - always logged but sanitized
     */
    warn(message: string, data?: unknown): void {
        console.warn(formatMessage('warn', message, data))
    },

    /**
     * Error logs - always logged but sanitized
     */
    error(message: string, error?: unknown): void {
        if (error instanceof Error) {
            console.error(formatMessage('error', message, {
                name: error.name,
                message: error.message,
                // Don't log stack traces in production
                ...(isDevelopment ? { stack: error.stack } : {})
            }))
        } else {
            console.error(formatMessage('error', message, sanitize(error)))
        }
    }
}

export default logger
