export type RollingBucket = {
	count: number
	startedAt: number
}

export interface TrafficMonitorConfig {
	/** Length of each rolling window in ms. Default: RATE_ALERT_WINDOW_MS env var or 60_000 */
	windowMs?: number
	/** Minimum cooldown between alerts for the same key in ms. Default: RATE_ALERT_MIN_INTERVAL_MS env var or 60_000 */
	minIntervalMs?: number
	/** Per-IP request count within the window that triggers an alert. Default: RATE_ALERT_IP_REQ_THRESHOLD env var or 180 */
	ipReqThreshold?: number
	/** Global 429 count within the window that triggers an alert. Default: RATE_ALERT_429_THRESHOLD env var or 40 */
	threshold429?: number
	/** Optional webhook URL to POST alert payloads to. Default: RATE_ALERT_WEBHOOK_URL env var */
	webhookUrl?: string
	/**
	 * Custom notifier function. Receives the alert payload. Use in tests to inject a spy.
	 * When omitted the default notifier logs to console.warn and optionally POSTs to webhookUrl.
	 */
	notifier?: (payload: Record<string, unknown>) => Promise<void>
}

export class TrafficMonitor {
	private readonly windowMs: number
	private readonly minIntervalMs: number
	private readonly ipReqThreshold: number
	private readonly threshold429: number
	private readonly webhookUrl: string | undefined
	private readonly notifier: (payload: Record<string, unknown>) => Promise<void>

	/** Exposed for testing / inspection */
	readonly ipRequestBuckets = new Map<string, RollingBucket>()
	readonly ip429Buckets = new Map<string, RollingBucket>()
	global429Bucket: RollingBucket = { count: 0, startedAt: Date.now() }
	private readonly lastAlertAtByKey = new Map<string, number>()

	constructor(config: TrafficMonitorConfig = {}) {
		this.windowMs = config.windowMs ?? Number(process.env.RATE_ALERT_WINDOW_MS ?? 60_000)
		this.minIntervalMs = config.minIntervalMs ?? Number(process.env.RATE_ALERT_MIN_INTERVAL_MS ?? 60_000)
		this.ipReqThreshold = config.ipReqThreshold ?? Number(process.env.RATE_ALERT_IP_REQ_THRESHOLD ?? 180)
		this.threshold429 = config.threshold429 ?? Number(process.env.RATE_ALERT_429_THRESHOLD ?? 40)
		this.webhookUrl = config.webhookUrl ?? process.env.RATE_ALERT_WEBHOOK_URL
		this.notifier = config.notifier ?? this._defaultNotifier.bind(this)
	}

	rotateBucket(bucket: RollingBucket, now: number): void {
		if (now - bucket.startedAt > this.windowMs) {
			bucket.count = 0
			bucket.startedAt = now
		}
	}

	getOrCreateBucket(map: Map<string, RollingBucket>, key: string, now: number): RollingBucket {
		const existing = map.get(key)
		if (existing) {
			this.rotateBucket(existing, now)
			return existing
		}
		const created: RollingBucket = { count: 0, startedAt: now }
		map.set(key, created)
		return created
	}

	formatTopIps(map: Map<string, RollingBucket>, now: number, limit = 5): Array<{ ip: string; count: number }> {
		return Array.from(map.entries())
			.map(([ip, bucket]) => {
				this.rotateBucket(bucket, now)
				return { ip, count: bucket.count }
			})
			.filter(row => row.count > 0)
			.sort((a, b) => b.count - a.count)
			.slice(0, limit)
	}

	shouldEmitAlert(key: string, now: number): boolean {
		const last = this.lastAlertAtByKey.get(key)
		if (last !== undefined && now - last < this.minIntervalMs) return false
		this.lastAlertAtByKey.set(key, now)
		return true
	}

	async emitTrafficAlert(type: 'ip_request_spike' | 'http_429_spike', details: Record<string, unknown>): Promise<void> {
		const payload: Record<string, unknown> = {
			type,
			service: 'simmer-api',
			occurredAt: new Date().toISOString(),
			windowMs: this.windowMs,
			...details,
		}
		await this.notifier(payload)
	}

	private async _defaultNotifier(payload: Record<string, unknown>): Promise<void> {
		console.warn('[traffic-alert]', JSON.stringify(payload))
		if (!this.webhookUrl) return
		try {
			await fetch(this.webhookUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error)
			console.error('[traffic-alert webhook]', msg)
		}
	}

	middleware() {
		return (req: any, res: any, next: any) => {
			const now = Date.now()
			const ip = String(req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown')

			const ipReqBucket = this.getOrCreateBucket(this.ipRequestBuckets, ip, now)
			ipReqBucket.count += 1

			if (ipReqBucket.count >= this.ipReqThreshold && this.shouldEmitAlert(`ip:req:${ip}`, now)) {
				void this.emitTrafficAlert('ip_request_spike', {
					ip,
					requestCount: ipReqBucket.count,
					threshold: this.ipReqThreshold,
					topIpsByRequestVolume: this.formatTopIps(this.ipRequestBuckets, now),
					path: req.originalUrl as string,
					method: req.method as string,
				})
			}

			res.on('finish', () => {
				const doneAt = Date.now()
				this.rotateBucket(this.global429Bucket, doneAt)

				if ((res.statusCode as number) !== 429) return

				const ip429Bucket = this.getOrCreateBucket(this.ip429Buckets, ip, doneAt)
				ip429Bucket.count += 1
				this.global429Bucket.count += 1

				if (this.global429Bucket.count >= this.threshold429 && this.shouldEmitAlert('global:429', doneAt)) {
					void this.emitTrafficAlert('http_429_spike', {
						statusCode: 429,
						global429Count: this.global429Bucket.count,
						threshold: this.threshold429,
						topIpsBy429Volume: this.formatTopIps(this.ip429Buckets, doneAt),
					})
				}
			})

			next()
		}
	}
}

/**
 * Convenience factory — creates a `TrafficMonitor` with the given config and
 * returns its Express middleware.  The underlying `TrafficMonitor` instance is
 * NOT exposed; use `new TrafficMonitor(config)` directly when you need access
 * to internal state (e.g. in tests).
 */
export const createTrafficMonitorMiddleware = (config?: TrafficMonitorConfig) => new TrafficMonitor(config).middleware()
