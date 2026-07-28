/* eslint-disable import/first */
import dotenv from 'dotenv'
import process from 'node:process'
import mongoose, { type ConnectOptions } from 'mongoose'

dotenv.config({ path: ['.env', '.production.env', '.development.env'] })

const config = require('../constants/config').config as typeof import('../constants/config').config
const Moment = require('../resources/moment/model').Moment as typeof import('../resources/moment/model').Moment

type Stats = {
	totalMomentsScanned: number
	totalImageUrlsScanned: number
	totalMomentsUpdated: number
	totalUrlsChanged: number
	totalUrlsDropped: number
	totalErrors: number
}

const stats: Stats = {
	totalMomentsScanned: 0,
	totalImageUrlsScanned: 0,
	totalMomentsUpdated: 0,
	totalUrlsChanged: 0,
	totalUrlsDropped: 0,
	totalErrors: 0,
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const verbose = args.includes('--verbose')
const limitArg = args.find(arg => arg.startsWith('--limit='))
const idArg = args.find(arg => arg.startsWith('--moment-id='))

const limit = limitArg ? Number.parseInt(limitArg.replace('--limit=', ''), 10) : null
const momentId = idArg ? idArg.replace('--moment-id=', '').trim() : ''

const connectDirect = async (): Promise<typeof mongoose> => {
	if (mongoose.connection.readyState === 1) {
		return mongoose
	}

	const dbUrl = config.mongoDB.username
		? `mongodb://${config.mongoDB.username}:${encodeURIComponent(String(config.mongoDB.password || ''))}@${config.mongoDB.host}:${config.mongoDB.port}`
		: `mongodb://${config.mongoDB.host}:${config.mongoDB.port}`

	const options: ConnectOptions = {
		dbName: config.mongoDB.dbName,
		tlsCAFile: process.env.MONGODB_TLS_CA_FILE || 'global-bundle.pem',
		serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || '30000'),
	}

	return await mongoose.connect(dbUrl, options)
}

const decodeSafe = (value: string): string => {
	try {
		return decodeURIComponent(value)
	} catch {
		return value
	}
}

const stripQuery = (value: string): string => value.split('?')[0]

const extractS3KeyFromUrl = (raw: string): string => {
	const value = String(raw || '').trim()
	if (!value) {
		return ''
	}

	if (!/^https?:\/\//i.test(value)) {
		return decodeSafe(stripQuery(value).replace(/^\/+/, ''))
	}

	const noQuery = stripQuery(value)
	const meetingDateMarker = '/meeting_date/'
	const idx = noQuery.indexOf(meetingDateMarker)
	if (idx !== -1) {
		return decodeSafe(noQuery.slice(idx + 1))
	}

	const amazonawsMarker = '.amazonaws.com/'
	const s3Idx = noQuery.indexOf(amazonawsMarker)
	if (s3Idx !== -1) {
		return decodeSafe(noQuery.slice(s3Idx + amazonawsMarker.length).replace(/^\/+/, ''))
	}

	try {
		const parsed = new URL(value)
		return decodeSafe(parsed.pathname.replace(/^\/+/, ''))
	} catch {
		return decodeSafe(value)
	}
}

const normalizeImageUrlEntry = (raw: unknown): string => {
	if (typeof raw !== 'string') {
		return ''
	}
	const normalized = extractS3KeyFromUrl(raw)
	if (!normalized) {
		return ''
	}

	// For safety, only keep meeting_date keys in this migration.
	if (normalized.startsWith('meeting_date/')) {
		return normalized
	}
	return normalized
}

const run = async () => {
	console.log('normalizeMomentImageUrls')
	console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
	if (momentId) {
		console.log(`moment-id filter: ${momentId}`)
	}
	if (limit) {
		console.log(`limit: ${limit}`)
	}

	await connectDirect()

	const query: Record<string, unknown> = {
		image_urls: { $exists: true, $ne: [] },
	}
	if (momentId) {
		query._id = momentId
	}

	const moments = await Moment.find(query)
		.limit(limit || 0)
		.lean()

	for (const moment of moments) {
		stats.totalMomentsScanned += 1
		const imageUrls = Array.isArray(moment.image_urls) ? moment.image_urls : []
		stats.totalImageUrlsScanned += imageUrls.length

		const nextUrls = imageUrls.map(normalizeImageUrlEntry).filter(url => Boolean(url))

		const uniqueNextUrls = [...new Set(nextUrls)]
		const currentUrls = imageUrls.map(item => String(item || ''))

		const changed = uniqueNextUrls.length !== currentUrls.length || uniqueNextUrls.some((url, idx) => url !== currentUrls[idx])

		if (!changed) {
			continue
		}

		const dropped = currentUrls.length - uniqueNextUrls.length
		const changedCount = Math.max(0, uniqueNextUrls.length)
		stats.totalUrlsChanged += changedCount
		if (dropped > 0) {
			stats.totalUrlsDropped += dropped
		}

		if (verbose) {
			console.log(`moment ${String(moment._id)}:`)
			console.log('  before:', currentUrls)
			console.log('  after :', uniqueNextUrls)
		}

		if (apply) {
			try {
				await Moment.updateOne({ _id: moment._id }, { image_urls: uniqueNextUrls })
				stats.totalMomentsUpdated += 1
			} catch (error) {
				stats.totalErrors += 1
				console.error(`Failed to update moment ${String(moment._id)}:`, error)
			}
		}
	}

	console.log('--- summary ---')
	console.log(`moments scanned : ${stats.totalMomentsScanned}`)
	console.log(`image urls seen : ${stats.totalImageUrlsScanned}`)
	console.log(`urls changed    : ${stats.totalUrlsChanged}`)
	console.log(`urls dropped    : ${stats.totalUrlsDropped}`)
	console.log(`moments updated : ${stats.totalMomentsUpdated}`)
	console.log(`errors          : ${stats.totalErrors}`)

	await mongoose.disconnect()
}

void run().catch(async error => {
	console.error('normalizeMomentImageUrls failed:', error)
	try {
		await mongoose.disconnect()
	} catch {
		// ignore disconnect errors on crash path
	}
	process.exitCode = 1
})
