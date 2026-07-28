import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrafficMonitor, type RollingBucket } from './trafficMonitor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMonitor = (overrides: ConstructorParameters<typeof TrafficMonitor>[0] = {}) =>
	new TrafficMonitor({
		windowMs: 10_000,
		minIntervalMs: 5_000,
		ipReqThreshold: 5,
		threshold429: 3,
		notifier: vi.fn(),
		...overrides,
	})

const bucket = (count: number, startedAt: number): RollingBucket => ({ count, startedAt })

// ---------------------------------------------------------------------------
// rotateBucket
// ---------------------------------------------------------------------------

describe('rotateBucket', () => {
	it('resets count and startedAt when window has elapsed', () => {
		const monitor = makeMonitor()
		const now = Date.now()
		const b = bucket(99, now - 11_000) // older than windowMs (10_000)
		monitor.rotateBucket(b, now)
		expect(b.count).toBe(0)
		expect(b.startedAt).toBe(now)
	})

	it('does NOT reset when still within the window', () => {
		const monitor = makeMonitor()
		const now = Date.now()
		const b = bucket(99, now - 5_000) // within windowMs
		monitor.rotateBucket(b, now)
		expect(b.count).toBe(99)
	})
})

// ---------------------------------------------------------------------------
// getOrCreateBucket
// ---------------------------------------------------------------------------

describe('getOrCreateBucket', () => {
	it('creates a new bucket for an unknown key', () => {
		const monitor = makeMonitor()
		const now = Date.now()
		const b = monitor.getOrCreateBucket(monitor.ipRequestBuckets, '1.2.3.4', now)
		expect(b).toEqual({ count: 0, startedAt: now })
		expect(monitor.ipRequestBuckets.has('1.2.3.4')).toBe(true)
	})

	it('returns the existing bucket for a known key', () => {
		const monitor = makeMonitor()
		const now = Date.now()
		const first = monitor.getOrCreateBucket(monitor.ipRequestBuckets, '1.2.3.4', now)
		first.count = 7
		const second = monitor.getOrCreateBucket(monitor.ipRequestBuckets, '1.2.3.4', now)
		expect(second).toBe(first)
		expect(second.count).toBe(7)
	})

	it('rotates an existing bucket when its window has expired', () => {
		const monitor = makeMonitor()
		const now = Date.now()
		monitor.ipRequestBuckets.set('1.2.3.4', bucket(50, now - 15_000))
		const b = monitor.getOrCreateBucket(monitor.ipRequestBuckets, '1.2.3.4', now)
		expect(b.count).toBe(0)
		expect(b.startedAt).toBe(now)
	})
})

// ---------------------------------------------------------------------------
// formatTopIps
// ---------------------------------------------------------------------------

describe('formatTopIps', () => {
	it('returns IPs sorted by count descending', () => {
		const monitor = makeMonitor()
		const now = Date.now()
		monitor.ipRequestBuckets.set('a', bucket(3, now))
		monitor.ipRequestBuckets.set('b', bucket(7, now))
		monitor.ipRequestBuckets.set('c', bucket(1, now))
		const result = monitor.formatTopIps(monitor.ipRequestBuckets, now, 5)
		expect(result.map(r => r.ip)).toEqual(['b', 'a', 'c'])
	})

	it('excludes IPs whose bucket has rotated (count == 0)', () => {
		const monitor = makeMonitor()
		const now = Date.now()
		monitor.ipRequestBuckets.set('stale', bucket(99, now - 20_000)) // expired
		monitor.ipRequestBuckets.set('fresh', bucket(5, now))
		const result = monitor.formatTopIps(monitor.ipRequestBuckets, now, 5)
		expect(result.map(r => r.ip)).toEqual(['fresh'])
	})

	it('limits output to the requested number of entries', () => {
		const monitor = makeMonitor()
		const now = Date.now()
		for (let i = 0; i < 10; i++) {
			monitor.ipRequestBuckets.set(`ip${i}`, bucket(i + 1, now))
		}
		const result = monitor.formatTopIps(monitor.ipRequestBuckets, now, 3)
		expect(result).toHaveLength(3)
	})
})

// ---------------------------------------------------------------------------
// shouldEmitAlert
// ---------------------------------------------------------------------------

describe('shouldEmitAlert', () => {
	it('returns true on first call for a key', () => {
		const monitor = makeMonitor()
		expect(monitor.shouldEmitAlert('some-key', Date.now())).toBe(true)
	})

	it('returns false when called again within the cooldown interval', () => {
		const monitor = makeMonitor()
		const now = Date.now()
		monitor.shouldEmitAlert('key', now)
		expect(monitor.shouldEmitAlert('key', now + 1_000)).toBe(false) // 1 s < 5 s cooldown
	})

	it('returns true once the cooldown has elapsed', () => {
		const monitor = makeMonitor()
		const now = Date.now()
		monitor.shouldEmitAlert('key', now)
		expect(monitor.shouldEmitAlert('key', now + 6_000)).toBe(true) // 6 s > 5 s cooldown
	})
})

// ---------------------------------------------------------------------------
// emitTrafficAlert — notifier integration
// ---------------------------------------------------------------------------

describe('emitTrafficAlert', () => {
	it('calls the notifier with the correct payload shape', async () => {
		const notifier = vi.fn().mockResolvedValue(undefined)
		const monitor = makeMonitor({ notifier })

		await monitor.emitTrafficAlert('ip_request_spike', { ip: '9.9.9.9', requestCount: 10 })

		expect(notifier).toHaveBeenCalledOnce()
		const [payload] = notifier.mock.calls[0]
		expect(payload).toMatchObject({
			type: 'ip_request_spike',
			service: 'simmer-api',
			windowMs: 10_000,
			ip: '9.9.9.9',
			requestCount: 10,
		})
		expect(typeof payload.occurredAt).toBe('string')
	})

	it('calls the notifier with http_429_spike type', async () => {
		const notifier = vi.fn().mockResolvedValue(undefined)
		const monitor = makeMonitor({ notifier })

		await monitor.emitTrafficAlert('http_429_spike', { global429Count: 5 })

		const [payload] = notifier.mock.calls[0]
		expect(payload.type).toBe('http_429_spike')
		expect(payload.global429Count).toBe(5)
	})
})

// ---------------------------------------------------------------------------
// middleware — ip request spike
// ---------------------------------------------------------------------------

describe('middleware — ip request spike', () => {
	let monitor: TrafficMonitor
	let notifier: ReturnType<typeof vi.fn>

	beforeEach(() => {
		notifier = vi.fn().mockResolvedValue(undefined)
		monitor = makeMonitor({ ipReqThreshold: 3, notifier })
	})

	const makeReqRes = (ip = '1.1.1.1', statusCode = 200) => {
		const finishListeners: Array<() => void> = []
		const req: any = { ip, headers: {}, originalUrl: '/test', method: 'GET' }
		const res: any = {
			statusCode,
			on: (event: string, cb: () => void) => {
				if (event === 'finish') finishListeners.push(cb)
			},
			emit: (event: string) => {
				if (event === 'finish') finishListeners.forEach(fn => fn())
			},
		}
		return { req, res }
	}

	it('does NOT alert before the threshold is reached', () => {
		const mw = monitor.middleware()
		const next = vi.fn()
		const { req, res } = makeReqRes()
		mw(req, res, next) // count = 1
		mw(req, res, next) // count = 2
		expect(notifier).not.toHaveBeenCalled()
	})

	it('calls next() for every request', () => {
		const mw = monitor.middleware()
		const next = vi.fn()
		const { req, res } = makeReqRes()
		mw(req, res, next)
		expect(next).toHaveBeenCalledOnce()
	})

	it('fires ip_request_spike alert once the threshold is reached', async () => {
		const mw = monitor.middleware()
		const next = vi.fn()
		// threshold = 3
		for (let i = 0; i < 3; i++) {
			const { req, res } = makeReqRes()
			mw(req, res, next)
		}
		// give the void promise a tick to settle
		await Promise.resolve()
		expect(notifier).toHaveBeenCalledOnce()
		expect(notifier.mock.calls[0][0]).toMatchObject({ type: 'ip_request_spike', ip: '1.1.1.1' })
	})

	it('does NOT fire a second alert within the cooldown window', async () => {
		const mw = monitor.middleware()
		const next = vi.fn()
		for (let i = 0; i < 5; i++) {
			const { req, res } = makeReqRes()
			mw(req, res, next)
		}
		await Promise.resolve()
		// Alert should have fired exactly once despite 5 requests exceeding threshold
		expect(notifier).toHaveBeenCalledOnce()
	})
})

// ---------------------------------------------------------------------------
// middleware — global 429 spike
// ---------------------------------------------------------------------------

describe('middleware — global 429 spike', () => {
	let monitor: TrafficMonitor
	let notifier: ReturnType<typeof vi.fn>

	beforeEach(() => {
		notifier = vi.fn().mockResolvedValue(undefined)
		monitor = makeMonitor({ threshold429: 2, ipReqThreshold: 9999, notifier })
	})

	const fire429 = (mw: ReturnType<TrafficMonitor['middleware']>, ip = '2.2.2.2') => {
		const finishCbs: Array<() => void> = []
		const req: any = { ip, headers: {}, originalUrl: '/api', method: 'GET' }
		const res: any = {
			statusCode: 429,
			on: (event: string, cb: () => void) => {
				if (event === 'finish') finishCbs.push(cb)
			},
		}
		const next = vi.fn()
		mw(req, res, next)
		finishCbs.forEach(cb => cb())
	}

	it('increments ip429Buckets on each 429 response', () => {
		const mw = monitor.middleware()
		fire429(mw, '3.3.3.3')
		expect(monitor.ip429Buckets.get('3.3.3.3')?.count).toBe(1)
	})

	it('increments global429Bucket on each 429', () => {
		const mw = monitor.middleware()
		fire429(mw)
		fire429(mw)
		expect(monitor.global429Bucket.count).toBe(2)
	})

	it('fires http_429_spike once the threshold is reached', async () => {
		const mw = monitor.middleware()
		// threshold = 2
		fire429(mw)
		fire429(mw)
		await Promise.resolve()
		expect(notifier).toHaveBeenCalledOnce()
		expect(notifier.mock.calls[0][0]).toMatchObject({ type: 'http_429_spike', statusCode: 429 })
	})

	it('does NOT fire alert on non-429 responses', async () => {
		const mw = monitor.middleware()
		const req: any = { ip: '5.5.5.5', headers: {}, originalUrl: '/', method: 'GET' }
		const finishCbs: Array<() => void> = []
		const res: any = {
			statusCode: 200,
			on: (event: string, cb: () => void) => {
				if (event === 'finish') finishCbs.push(cb)
			},
		}
		mw(req, res, vi.fn())
		finishCbs.forEach(cb => cb())
		await Promise.resolve()
		expect(notifier).not.toHaveBeenCalled()
		expect(monitor.global429Bucket.count).toBe(0)
	})
})
