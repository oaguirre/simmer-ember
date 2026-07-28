import express from 'express'
import * as http from 'http'
import apicache from 'apicache'
import morgan from 'morgan'
import compression from 'compression'
import { type Request } from 'express'
import { config } from './constants'
import { ApiError, apiErrorHandler, connect } from './utils'
import { killProcessOnPort } from './utils/killProcessOnPort'
import { socketIO } from './utils/socketio'
import { registerRoutes } from './utils/router'
import swaggerUi from 'swagger-ui-express'
import { openapiSpec } from './docs'
import cors from 'cors'
import { createTrafficMonitorMiddleware } from './utils/trafficMonitor'
import { globalLimiter, authLimiter, expensiveLimiter, uploadLimiter, cspReportLimiter } from './utils/limiter'
import { logger } from './utils/logger'

export const app = express()

const maskSecretLast4 = (value?: string): string => {
	if (!value) {
		return 'missing'
	}
	const tail = value.slice(-4)
	return `***${tail}`
}

// eslint-disable-next-line promise/no-callback-in-promise
const use = (fn: (req: any, res: any, next: any) => any) => async (req: any, res: any, next: any) => await Promise.resolve(fn(req, res, next)).catch(next)

// Ensure req.ip is derived correctly when deployed behind a load balancer / reverse proxy.
app.set('trust proxy', process.env.TRUST_PROXY ?? 1)
app.disable('x-powered-by')

app.use(globalLimiter)
app.use('/signup', authLimiter)
app.use('/signin', authLimiter)
app.use('/api/user/meet', expensiveLimiter)
app.use('/api/user/meet/image-only', expensiveLimiter)
app.use('/api/user/image', uploadLimiter)

app.use(createTrafficMonitorMiddleware())

app.use((req: any, res: any, next: any) => {
	const defaultTimeoutMs = 30_000
	const longRequestTimeoutMs = config.timeout || 300_000
	const isLongRunningMeetRequest = req.path?.startsWith('/api/user/meet')
	const timeoutMs = isLongRunningMeetRequest ? longRequestTimeoutMs : defaultTimeoutMs
	req.setTimeout(timeoutMs)
	res.setTimeout(timeoutMs)
	next()
})

app.use(compression())
app.use(cors(config.cors))
app.use((req: any, res: any, next: any) => {
	res.header('Vary', 'Origin')
	next()
})
// app.use(apicache.middleware('5 minutes'))
app.use(express.json({ limit: '200kb' }))
app.use(express.urlencoded({ extended: true, limit: '200kb' }))
app.disable('etag')
morgan.token('date-local', () => new Date().toISOString())
morgan.token('requester', (req: any) => req.requester?._id || '-')
app.use(morgan('[:date-local] [:requester] :method :url :status :response-time ms'))

const cspReportParser = express.json({
	type: ['application/csp-report', 'application/reports+json', 'application/json'],
	limit: '100kb',
})

app.post('/csp-report', cspReportLimiter, cspReportParser, (req: any, res: any) => {
	const payload = req.body?.['csp-report'] ?? req.body
	logger.warn('-', '[csp-report]', {
		ip: req.ip,
		user_agent: req.get('user-agent') || '-',
		report: payload,
	})
	res.status(204).end()
})

app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec))
app.use('/uploads', express.static('uploads'))

registerRoutes(app)

app.get('/health', (req: Request, res: any) => {
	res.status(200).send('OK')
})
app.use('/static', express.static('static'))

app.use((req: any, res: Request, next: any) => {
	if (next) {
		next(new ApiError(404, `Not found: ${req.originalUrl}`, 'server'))
	}
})
app.use(apiErrorHandler)

export const server = () => {
	const port = config.port || 4000
	try {
		killProcessOnPort(port, () => {
			void connect()
			const httpServer = http.createServer(app)
			httpServer.timeout = config.timeout || 300000
			httpServer.requestTimeout = config.timeout || 300000
			httpServer.headersTimeout = 65_000
			httpServer.keepAliveTimeout = 5_000
			httpServer.listen(port, () => {
				console.log(`Server listening on port ${port} and timeout ${httpServer.timeout}`)
				console.log(`AWS_ACCESS_KEY_ID(last4): ${maskSecretLast4(process.env.AWS_ACCESS_KEY_ID)}`)
				console.log(`AWS_SECRET_ACCESS_KEY(last4): ${maskSecretLast4(process.env.AWS_SECRET_ACCESS_KEY)}`)
			})
			void socketIO(httpServer)
		})
	} catch (error) {
		console.error('[server] ', error)
	}
}
