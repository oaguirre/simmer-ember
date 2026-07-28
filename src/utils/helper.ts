export const DEFAULT_MAX_DATE_OF_BIRTH_AGE_YEARS = 100

const normalizeDateOnly = (value: Date): Date => new Date(value.getFullYear(), value.getMonth(), value.getDate())

export const parseDateOfBirthInput = (value: unknown): Date | null => {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) {
			return null
		}
		return normalizeDateOnly(value)
	}

	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			return null
		}
		const epochMs = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value
		const parsedFromEpoch = new Date(epochMs)
		if (Number.isNaN(parsedFromEpoch.getTime())) {
			return null
		}
		return normalizeDateOnly(parsedFromEpoch)
	}

	if (typeof value !== 'string') {
		return null
	}

	const trimmed = value.trim()
	if (!trimmed) {
		return null
	}

	if (/^\d+(\.\d+)?$/.test(trimmed)) {
		const numericValue = Number(trimmed)
		return parseDateOfBirthInput(numericValue)
	}

	const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
	if (dateMatch) {
		const year = Number(dateMatch[1])
		const month = Number(dateMatch[2])
		const day = Number(dateMatch[3])
		const parsed = new Date(year, month - 1, day)

		if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
			return null
		}

		return parsed
	}

	const parsedTimestamp = Date.parse(trimmed)
	if (Number.isNaN(parsedTimestamp)) {
		return null
	}

	return normalizeDateOnly(new Date(parsedTimestamp))
}

export const isDateOfBirthInAllowedRange = (parsed: Date, maxAgeYears = DEFAULT_MAX_DATE_OF_BIRTH_AGE_YEARS): boolean => {
	const today = new Date()
	today.setHours(0, 0, 0, 0)

	if (parsed > today) {
		return false
	}

	const oldestAllowed = new Date(today)
	oldestAllowed.setFullYear(today.getFullYear() - maxAgeYears)

	return parsed >= oldestAllowed
}
