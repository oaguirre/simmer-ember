import mongoose, { type ConnectOptions } from 'mongoose'

import { config, termcolors } from '../constants'

const MAX_INITIAL_RETRIES = Number.parseInt(process.env.MONGODB_CONNECT_MAX_RETRIES || '10', 10)
const MAX_RUNTIME_RETRIES = Number.parseInt(process.env.MONGODB_RECONNECT_MAX_RETRIES || '0', 10) // 0 = unlimited
const RETRY_BASE_DELAY_MS = Number.parseInt(process.env.MONGODB_RETRY_BASE_DELAY_MS || '1000', 10)
const SERVER_SELECTION_TIMEOUT_MS = Number.parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || '30000', 10)

let reconnectInProgress = false
let runtimeReconnectAttempts = 0
let listenersRegistered = false

const wait = async (ms: number): Promise<void> => {
	await new Promise(resolve => setTimeout(resolve, ms))
}

const computeDelayMs = (attempt: number): number => {
	const boundedAttempt = Math.min(6, Math.max(1, attempt))
	return RETRY_BASE_DELAY_MS * 2 ** (boundedAttempt - 1)
}

const getDbUrl = (): string => {
	return config.mongoDB.username
		? `mongodb://${config.mongoDB.username}:${encodeURIComponent(String(config.mongoDB.password))}@${config.mongoDB.host}:${config.mongoDB.port}/`
		: `mongodb://${config.mongoDB.host}:${config.mongoDB.port}`
}

const canRetryRuntimeReconnect = (): boolean => {
	if (MAX_RUNTIME_RETRIES === 0) {
		return true
	}
	return runtimeReconnectAttempts < MAX_RUNTIME_RETRIES
}

const connectWithRetry = async (maxRetries: number): Promise<typeof mongoose> => {
	const dbUrl = getDbUrl()
	let attempt = 0

	while (attempt < maxRetries) {
		attempt += 1
		try {
			if (mongoose.connection.readyState === 1) {
				return mongoose
			}
			await mongoose.connect(dbUrl, {
				dbName: config.mongoDB.dbName,
				tlsCAFile: 'global-bundle.pem',
				serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
			} satisfies ConnectOptions)
			console.log(termcolors.fgGreen + `Connected to database (attempt ${attempt})` + termcolors.reset)
			runtimeReconnectAttempts = 0
			return mongoose
		} catch (err) {
			console.error(
				`Mongo connection attempt ${attempt}/${maxRetries} failed: ${String(err)} ` +
					`host ${config.mongoDB.host}:${config.mongoDB.port} username ${config.mongoDB.username} dbName ${config.mongoDB.dbName} password: [REDACTED]`,
			)
			if (attempt >= maxRetries) {
				throw err
			}
			await wait(computeDelayMs(attempt))
		}
	}

	throw new Error('Mongo retry loop exited unexpectedly')
}

const scheduleRuntimeReconnect = (): void => {
	if (process.env.NODE_ENV === 'test') {
		return
	}
	if (reconnectInProgress || mongoose.connection.readyState === 1) {
		return
	}
	if (!canRetryRuntimeReconnect()) {
		console.error(`Mongo runtime reconnect attempts exhausted (${MAX_RUNTIME_RETRIES}).`)
		return
	}

	reconnectInProgress = true
	runtimeReconnectAttempts += 1
	const delayMs = computeDelayMs(runtimeReconnectAttempts)

	setTimeout(async () => {
		try {
			await connectWithRetry(1)
		} catch (error) {
			console.error(`Mongo runtime reconnect attempt ${runtimeReconnectAttempts} failed:`, error)
		} finally {
			reconnectInProgress = false
			if (mongoose.connection.readyState !== 1 && canRetryRuntimeReconnect()) {
				scheduleRuntimeReconnect()
			}
		}
	}, delayMs)
}

const registerConnectionListeners = (): void => {
	if (listenersRegistered || process.env.NODE_ENV === 'test') {
		return
	}
	listenersRegistered = true

	mongoose.connection.on('connected', () => {
		runtimeReconnectAttempts = 0
		console.log(termcolors.fgGreen + 'Mongo connection is healthy.' + termcolors.reset)
	})

	mongoose.connection.on('disconnected', () => {
		console.warn('Mongo disconnected. Scheduling reconnect...')
		scheduleRuntimeReconnect()
	})

	mongoose.connection.on('error', error => {
		console.error('Mongo connection error:', error)
		if (mongoose.connection.readyState !== 1) {
			scheduleRuntimeReconnect()
		}
	})
}

const connect =
	process.env.NODE_ENV !== 'test'
		? async (): Promise<typeof mongoose> => {
				registerConnectionListeners()
				return await connectWithRetry(MAX_INITIAL_RETRIES)
			}
		: async (): Promise<typeof mongoose> => {
				return mongoose
			}

mongoose.set('strictQuery', false)

console.log('Using MongoDB host:', config.mongoDB.host)
console.log('Using MongoDB port:', config.mongoDB.port)
console.log('Using MongoDB username:', config.mongoDB.username)
console.log('MongoDB password configured:', Boolean(config.mongoDB.password))

export default connect
