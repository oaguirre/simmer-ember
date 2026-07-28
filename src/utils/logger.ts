/**
 * Centralized logging utility with ISO date and requester ID formatting
 * Format: [ISO_DATE][requester_id_or_dash] message
 *
 * All object arguments are passed through `redact()` before serialization so
 * that sensitive fields (passwords, tokens, PII) are never written to logs.
 */

const SENSITIVE_KEYS = new Set([
	'password',
	'apikey',
	'api_key',
	'token',
	'accesstoken',
	'refreshtoken',
	'authorization',
	'email',
	'phone',
	'loc_address',
	'loc_postal_code',
	'loc_latitude',
	'loc_longitude',
	'date_of_birth',
	'last_name',
	'born_location',
])

/**
 * Recursively replaces the values of any key whose lower-cased name appears in
 * SENSITIVE_KEYS with the string '[REDACTED]'.  The original object is never
 * mutated.
 */
export function redact(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redact)
	}
	if (value !== null && typeof value === 'object') {
		const result: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			result[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v)
		}
		return result
	}
	return value
}

function formatDate(): string {
	return new Date().toISOString()
}

function formatRequesterId(requesterId: any): string {
	if (!requesterId) return '-'
	return String(requesterId)
}

function formatMessage(requesterId: any, ...args: any[]): string {
	const date = formatDate()
	const id = formatRequesterId(requesterId)
	const message = args
		.map(arg => {
			if (typeof arg === 'string') return arg
			if (arg instanceof Error) return arg.message
			try {
				return JSON.stringify(redact(arg))
			} catch {
				return String(arg)
			}
		})
		.join(' ')
	return `[${date}][${id}] ${message}`
}

export const logger = {
	info: (requesterId: any, ...args: any[]) => {
		console.log(formatMessage(requesterId, ...args))
	},

	warn: (requesterId: any, ...args: any[]) => {
		console.warn(formatMessage(requesterId, ...args))
	},

	error: (requesterId: any, ...args: any[]) => {
		console.error(formatMessage(requesterId, ...args))
	},

	debug: (requesterId: any, ...args: any[]) => {
		console.debug(formatMessage(requesterId, ...args))
	},
}
