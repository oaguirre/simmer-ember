import { describe, expect, it } from 'vitest'
import { redact } from './logger'

describe('redact', () => {
	it('leaves non-sensitive primitives unchanged', () => {
		expect(redact('hello')).toBe('hello')
		expect(redact(42)).toBe(42)
		expect(redact(null)).toBeNull()
		expect(redact(true)).toBe(true)
	})

	it('redacts top-level sensitive string fields', () => {
		const result = redact({
			password: 'secret123',
			email: 'user@example.com',
			phone: '+15550001234',
			loc_address: '123 Main St',
			loc_postal_code: '90210',
			loc_latitude: 34.05,
			loc_longitude: -118.24,
			date_of_birth: '1990-01-01',
			last_name: 'Smith',
			born_location: 'Los Angeles, CA',
		}) as Record<string, unknown>

		expect(result.password).toBe('[REDACTED]')
		expect(result.email).toBe('[REDACTED]')
		expect(result.phone).toBe('[REDACTED]')
		expect(result.loc_address).toBe('[REDACTED]')
		expect(result.loc_postal_code).toBe('[REDACTED]')
		expect(result.loc_latitude).toBe('[REDACTED]')
		expect(result.loc_longitude).toBe('[REDACTED]')
		expect(result.date_of_birth).toBe('[REDACTED]')
		expect(result.last_name).toBe('[REDACTED]')
		expect(result.born_location).toBe('[REDACTED]')
	})

	it('redacts token / apiKey variants', () => {
		const result = redact({
			token: 'jwt.abc.def',
			apiKey: 'sk-abc123',
			api_key: 'sk-xyz456',
			accessToken: 'at-123',
			refreshToken: 'rt-456',
			authorization: 'Bearer xyz',
		}) as Record<string, unknown>

		expect(result.token).toBe('[REDACTED]')
		expect(result.apiKey).toBe('[REDACTED]')
		expect(result.api_key).toBe('[REDACTED]')
		expect(result.accessToken).toBe('[REDACTED]')
		expect(result.refreshToken).toBe('[REDACTED]')
		expect(result.authorization).toBe('[REDACTED]')
	})

	it('preserves non-sensitive fields', () => {
		const result = redact({
			_id: 'abc123',
			first_name: 'Alice',
			loc_city: 'Los Angeles',
			loc_state: 'CA',
			loc_country: 'US',
		}) as Record<string, unknown>

		expect(result._id).toBe('abc123')
		expect(result.first_name).toBe('Alice')
		expect(result.loc_city).toBe('Los Angeles')
		expect(result.loc_state).toBe('CA')
		expect(result.loc_country).toBe('US')
	})

	it('redacts sensitive keys nested inside objects', () => {
		const result = redact({
			user: {
				first_name: 'Bob',
				email: 'bob@example.com',
				address: {
					loc_address: '99 Private Rd',
				},
			},
		}) as any

		expect(result.user.first_name).toBe('Bob')
		expect(result.user.email).toBe('[REDACTED]')
		expect(result.user.address.loc_address).toBe('[REDACTED]')
	})

	it('redacts sensitive keys inside arrays', () => {
		const result = redact([
			{ email: 'a@example.com', first_name: 'Alice' },
			{ email: 'b@example.com', first_name: 'Bob' },
		]) as any[]

		expect(result[0].email).toBe('[REDACTED]')
		expect(result[0].first_name).toBe('Alice')
		expect(result[1].email).toBe('[REDACTED]')
	})

	it('does not mutate the original object', () => {
		const original = { password: 'hunter2', name: 'Alice' }
		redact(original)
		expect(original.password).toBe('hunter2')
	})

	it('is case-insensitive for key matching', () => {
		const result = redact({ Password: 'abc', EMAIL: 'x@y.com' }) as any
		expect(result.Password).toBe('[REDACTED]')
		expect(result.EMAIL).toBe('[REDACTED]')
	})
})
