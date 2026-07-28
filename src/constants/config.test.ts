import { describe, expect, it } from 'vitest'
import { isServerAllowed } from './config'

describe('isServerAllowed', () => {
	it('should return true for undefined origin', () => {
		expect(isServerAllowed(undefined as any)).toBe(true)
	})

	it('should return true for null origin', () => {
		expect(isServerAllowed(null as any)).toBe(true)
	})

	it('should return true for empty string origin', () => {
		expect(isServerAllowed('')).toBe(true)
	})

	it('should allow configured exact origins', () => {
		expect(isServerAllowed('https://onboarding.simmerdate.com')).toBe(true)
		expect(isServerAllowed('https://api.simmerdate.com')).toBe(true)
	})

	it('should allow localhost origins for local development', () => {
		expect(isServerAllowed('http://localhost:3000')).toBe(true)
		expect(isServerAllowed('https://localhost:5173')).toBe(true)
	})

	it('should allow approved https subdomains by suffix', () => {
		expect(isServerAllowed('https://sandbox.lovable.dev')).toBe(true)
		expect(isServerAllowed('https://preview.sandbox.lovable.dev')).toBe(true)
		expect(isServerAllowed('https://app.simmerdate.com')).toBe(true)
	})

	it('should reject malicious lookalike origins', () => {
		expect(isServerAllowed('https://api.simmerdate.com.evil.com')).toBe(false)
		expect(isServerAllowed('https://simmerdate.com.evil.org')).toBe(false)
		expect(isServerAllowed('https://malicious-site.com')).toBe(false)
	})

	it('should reject invalid origin values', () => {
		expect(isServerAllowed('not-a-url')).toBe(false)
		expect(isServerAllowed('api.simmerdate.com')).toBe(false)
	})

	it('should reject non-https origins for suffix-only matches', () => {
		expect(isServerAllowed('http://app.simmerdate.com')).toBe(false)
	})
})
