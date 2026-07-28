import rateLimit from 'express-rate-limit'

const createLimiter = (windowMs: number, max: number, message: string) =>
	rateLimit({
		windowMs,
		max,
		message,
		standardHeaders: true,
		legacyHeaders: false,
		skip: (req: any) => {
			const whitelist = process.env.IP_WHITELIST?.split(',').map(ip => ip.trim())
			return Boolean(whitelist?.includes(req.ip))
		},
	})

export const globalLimiter = createLimiter(60 * 1000, 120, 'Too many requests, try again later.')
export const authLimiter = createLimiter(15 * 60 * 1000, 20, 'Too many authentication attempts. Please try again later.')
export const expensiveLimiter = createLimiter(5 * 60 * 1000, 10, 'Too many expensive requests. Please try again later.')
export const uploadLimiter = createLimiter(10 * 60 * 1000, 20, 'Too many upload requests. Please try again later.')
export const cspReportLimiter = createLimiter(60 * 1000, 20, 'Too many CSP reports. Please try again later.')
