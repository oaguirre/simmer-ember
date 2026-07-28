import { beforeEach, describe, expect, it, vi } from 'vitest'

const connectMock = vi.fn()
const onMock = vi.fn()
const setMock = vi.fn()

vi.mock('mongoose', () => ({
	default: {
		connect: connectMock,
		set: setMock,
		connection: {
			readyState: 0,
			on: onMock,
		},
	},
}))

vi.mock('../constants', () => ({
	config: {
		mongoDB: {
			host: 'localhost',
			port: '27017',
			dbName: 'NODE_API',
			username: 'tester',
			password: 'secret',
		},
	},
	termcolors: {
		fgGreen: '',
		reset: '',
	},
}))

describe('db connect retry', () => {
	beforeEach(() => {
		vi.resetModules()
		vi.clearAllMocks()
		process.env.NODE_ENV = 'development'
		process.env.MONGODB_RETRY_BASE_DELAY_MS = '0'
	})

	it('retries and eventually connects', async () => {
		process.env.MONGODB_CONNECT_MAX_RETRIES = '3'
		connectMock.mockRejectedValueOnce(new Error('temporary outage')).mockResolvedValueOnce({})

		const { default: connect } = await import('./db')
		await expect(connect()).resolves.toBeDefined()
		expect(connectMock).toHaveBeenCalledTimes(2)
	})

	it('fails after max retries', async () => {
		process.env.MONGODB_CONNECT_MAX_RETRIES = '2'
		connectMock.mockRejectedValue(new Error('db unavailable'))

		const { default: connect } = await import('./db')
		await expect(connect()).rejects.toThrow('db unavailable')
		expect(connectMock).toHaveBeenCalledTimes(2)
	})
})
