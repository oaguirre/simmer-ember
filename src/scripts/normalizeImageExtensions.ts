/* eslint-disable import/first */
import dotenv from 'dotenv'
import process from 'node:process'
import AWS from 'aws-sdk'
import mongoose from 'mongoose'
import { type ConnectOptions } from 'mongoose'

dotenv.config({ path: ['.env', '.production.env', '.development.env'] })

const config = require('../constants/config').config as typeof import('../constants/config').config
const Media = require('../resources/media/model').default as typeof import('../resources/media/model').default
const Moment = require('../resources/moment/model').Moment as typeof import('../resources/moment/model').Moment

type MimeType = 'image/jpeg' | 'image/png' | 'image/webp'
type FileExt = 'jpg' | 'png' | 'webp'

type Stats = {
	totalMediaScanned: number
	totalMomentsScanned: number
	totalMomentImageEntriesScanned: number
	totalKeysScanned: number
	missingKeys: number
	unknownTypeKeys: number
	metadataOnlyFixes: number
	renamedKeys: number
	mediaDocsUpdated: number
	momentDocsUpdated: number
	errors: number
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const onlyMedia = args.includes('--only-media')
const onlyMoments = args.includes('--only-moments')
const limitArg = args.find(arg => arg.startsWith('--limit='))
const prefixArg = args.find(arg => arg.startsWith('--prefix='))
const bucketArg = args.find(arg => arg.startsWith('--bucket='))

const limit = limitArg ? Number.parseInt(limitArg.replace('--limit=', ''), 10) : null
const keyPrefixFilter = prefixArg ? prefixArg.replace('--prefix=', '').trim() : ''
const targetBucket = bucketArg?.replace('--bucket=', '').trim() || process.env.S3_TARGET_BUCKET || process.env.AWS_TARGET_BUCKET || process.env.S3_BUCKET || 'simmer-prod'

const targetRegion = process.env.AWS_TARGET_REGION || process.env.AWS_REGION || 'us-east-1'
const targetAccessKey = process.env.AWS_TARGET_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID
const targetSecretKey = process.env.AWS_TARGET_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY

if (!targetAccessKey || !targetSecretKey) {
	throw new Error('Missing AWS target credentials. Set AWS_TARGET_ACCESS_KEY/AWS_TARGET_SECRET_KEY or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.')
}

const s3 = new AWS.S3({
	region: targetRegion,
	accessKeyId: targetAccessKey,
	secretAccessKey: targetSecretKey,
	signatureVersion: 'v2',
})

const connectDirect = async (): Promise<typeof mongoose> => {
	const dbUrl = config.mongoDB.username
		? `mongodb://${config.mongoDB.username}:${encodeURIComponent(String(config.mongoDB.password || ''))}@${config.mongoDB.host}:${config.mongoDB.port}`
		: `mongodb://${config.mongoDB.host}:${config.mongoDB.port}`

	const options: ConnectOptions = {
		dbName: config.mongoDB.dbName,
		tlsCAFile: 'global-bundle.pem',
		serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || '30000'),
	}

	return await mongoose.connect(dbUrl, options)
}

const stats: Stats = {
	totalMediaScanned: 0,
	totalMomentsScanned: 0,
	totalMomentImageEntriesScanned: 0,
	totalKeysScanned: 0,
	missingKeys: 0,
	unknownTypeKeys: 0,
	metadataOnlyFixes: 0,
	renamedKeys: 0,
	mediaDocsUpdated: 0,
	momentDocsUpdated: 0,
	errors: 0,
}

const keyMigrationCache = new Map<string, string>()
const missingKeyCache = new Set<string>()

const normalizeContentType = (value?: string): string =>
	String(value || '')
		.split(';')[0]
		.trim()
		.toLowerCase()

const detectMimeFromBytes = (buffer: Buffer): MimeType | null => {
	if (
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	) {
		return 'image/png'
	}
	if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
		return 'image/webp'
	}
	if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
		return 'image/jpeg'
	}
	return null
}

const mimeToExt = (mime: MimeType): FileExt => {
	if (mime === 'image/png') return 'png'
	if (mime === 'image/webp') return 'webp'
	return 'jpg'
}

const extensionFromKey = (key: string): string => {
	const cleaned = key.split('?')[0]
	const idx = cleaned.lastIndexOf('.')
	if (idx === -1) return ''
	return cleaned.slice(idx + 1).toLowerCase()
}

const stripQuery = (value: string): string => value.split('?')[0]

const extractS3Key = (raw: string): string => {
	const value = String(raw || '').trim()
	if (!value) return ''

	if (value.startsWith('http://') || value.startsWith('https://')) {
		const noQuery = stripQuery(value)
		const marker = '.amazonaws.com/'
		const markerIndex = noQuery.indexOf(marker)
		if (markerIndex !== -1) {
			return decodeURIComponent(noQuery.slice(markerIndex + marker.length))
		}
		const url = new URL(value)
		return decodeURIComponent(url.pathname.replace(/^\/+/, ''))
	}

	return decodeURIComponent(stripQuery(value).replace(/^\/+/, ''))
}

const copySourceForKey = (bucket: string, key: string): string => `${bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`

const objectExists = async (bucket: string, key: string): Promise<boolean> => {
	try {
		await s3.headObject({ Bucket: bucket, Key: key }).promise()
		return true
	} catch (error: any) {
		if (error?.code === 'NotFound' || error?.statusCode === 404) {
			return false
		}
		throw error
	}
}

const copyWithMetadata = async (bucket: string, fromKey: string, toKey: string, contentType: string, head: AWS.S3.HeadObjectOutput): Promise<void> => {
	await s3
		.copyObject({
			Bucket: bucket,
			Key: toKey,
			CopySource: copySourceForKey(bucket, fromKey),
			MetadataDirective: 'REPLACE',
			ContentType: contentType,
			Metadata: head.Metadata || {},
			CacheControl: head.CacheControl,
			ContentDisposition: head.ContentDisposition,
			ContentEncoding: head.ContentEncoding,
			ContentLanguage: head.ContentLanguage,
			Expires: head.Expires,
			StorageClass: head.StorageClass,
			WebsiteRedirectLocation: head.WebsiteRedirectLocation,
			ServerSideEncryption: head.ServerSideEncryption,
			SSEKMSKeyId: head.SSEKMSKeyId,
		})
		.promise()
}

const shouldSkipKey = (key: string): boolean => {
	if (!key) return true
	if (!keyPrefixFilter) return false
	return !key.startsWith(keyPrefixFilter)
}

const migrateKeyIfNeeded = async (rawKey: string): Promise<string> => {
	const key = extractS3Key(rawKey)
	if (!key) {
		return key
	}
	if (shouldSkipKey(key)) {
		return key
	}
	if (keyMigrationCache.has(key)) {
		return keyMigrationCache.get(key) || key
	}
	if (missingKeyCache.has(key)) {
		return key
	}

	stats.totalKeysScanned += 1

	let head: AWS.S3.HeadObjectOutput
	let probe: AWS.S3.GetObjectOutput
	try {
		;[head, probe] = await Promise.all([s3.headObject({ Bucket: targetBucket, Key: key }).promise(), s3.getObject({ Bucket: targetBucket, Key: key, Range: 'bytes=0-31' }).promise()])
	} catch (error: any) {
		if (error?.code === 'NotFound' || error?.statusCode === 404) {
			missingKeyCache.add(key)
			stats.missingKeys += 1
			keyMigrationCache.set(key, key)
			return key
		}
		stats.errors += 1
		throw error
	}

	const body = Buffer.isBuffer(probe.Body) ? probe.Body : Buffer.from((probe.Body as any) || '')
	const detectedMime = detectMimeFromBytes(body)
	if (!detectedMime) {
		stats.unknownTypeKeys += 1
		keyMigrationCache.set(key, key)
		return key
	}

	const currentExt = extensionFromKey(key)
	const expectedExt = mimeToExt(detectedMime)
	const expectedContentType = detectedMime
	const currentContentType = normalizeContentType(head.ContentType)
	const keyWithoutExt = key.includes('.') ? key.replace(/\.[^.\/]+$/, '') : key
	const targetKey = `${keyWithoutExt}.${expectedExt}`

	if (!apply) {
		if (key !== targetKey) {
			stats.renamedKeys += 1
		}
		if (currentContentType !== expectedContentType) {
			stats.metadataOnlyFixes += 1
		}
		keyMigrationCache.set(key, targetKey)
		return targetKey
	}

	if (key !== targetKey) {
		const targetExists = await objectExists(targetBucket, targetKey)
		if (!targetExists) {
			await copyWithMetadata(targetBucket, key, targetKey, expectedContentType, head)
		}
		await s3.deleteObject({ Bucket: targetBucket, Key: key }).promise()
		stats.renamedKeys += 1
		keyMigrationCache.set(key, targetKey)
		return targetKey
	}

	if (currentContentType !== expectedContentType) {
		await copyWithMetadata(targetBucket, key, key, expectedContentType, head)
		stats.metadataOnlyFixes += 1
	}

	keyMigrationCache.set(key, key)
	return key
}

const replaceKeyInMaybeUrl = (raw: string, newKey: string): string => {
	const value = String(raw || '')
	if (!value) return value
	const oldKey = extractS3Key(value)
	if (!oldKey || oldKey === newKey) {
		return value
	}
	if (value.startsWith('http://') || value.startsWith('https://')) {
		return value.replace(oldKey, newKey)
	}
	return newKey
}

const migrateMediaDocuments = async (): Promise<void> => {
	const query: any = {
		filename: { $exists: true, $ne: '' },
		type: 'image',
	}
	const cursor = Media.find(query).cursor()
	for await (const mediaDoc of cursor as any) {
		stats.totalMediaScanned += 1
		if (limit && stats.totalMediaScanned > limit) {
			break
		}
		const originalFilename = String(mediaDoc.filename || '')
		const normalizedOriginalKey = extractS3Key(originalFilename)
		if (!normalizedOriginalKey || shouldSkipKey(normalizedOriginalKey)) {
			continue
		}

		const newKey = await migrateKeyIfNeeded(normalizedOriginalKey)
		if (!newKey || newKey === normalizedOriginalKey) {
			continue
		}

		if (apply) {
			mediaDoc.filename = newKey
			if (typeof mediaDoc.path === 'string') {
				mediaDoc.path = replaceKeyInMaybeUrl(mediaDoc.path, newKey)
			}
			if (typeof mediaDoc.url === 'string') {
				mediaDoc.url = replaceKeyInMaybeUrl(mediaDoc.url, newKey)
			}
			await mediaDoc.save()
		}
		stats.mediaDocsUpdated += 1
	}
}

const migrateMomentImageUrls = async (): Promise<void> => {
	const query: any = {
		image_urls: { $exists: true, $ne: [] },
	}
	const cursor = Moment.find(query).cursor()
	for await (const momentDoc of cursor as any) {
		stats.totalMomentsScanned += 1
		if (limit && stats.totalMomentsScanned > limit) {
			break
		}

		const imageUrls: string[] = Array.isArray(momentDoc.image_urls) ? momentDoc.image_urls.map((item: any) => String(item || '')) : []
		if (imageUrls.length === 0) {
			continue
		}

		const migratedUrls: string[] = []
		let changed = false
		for (const rawUrl of imageUrls) {
			stats.totalMomentImageEntriesScanned += 1
			const rawKey = extractS3Key(rawUrl)
			if (!rawKey) {
				continue
			}
			if (shouldSkipKey(rawKey)) {
				migratedUrls.push(rawKey)
				continue
			}
			const newKey = await migrateKeyIfNeeded(rawKey)
			migratedUrls.push(newKey)
			if (newKey !== rawKey || rawUrl !== rawKey) {
				changed = true
			}
		}

		const deduped = Array.from(new Set(migratedUrls.filter(Boolean)))
		if (!changed && deduped.length === imageUrls.length && deduped.every((value, idx) => value === imageUrls[idx])) {
			continue
		}

		if (apply) {
			momentDoc.image_urls = deduped
			await momentDoc.save()
		}
		stats.momentDocsUpdated += 1
	}
}

const main = async (): Promise<void> => {
	console.log('Starting image extension normalization')
	console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`)
	console.log(`Bucket: ${targetBucket}`)
	if (keyPrefixFilter) {
		console.log(`Prefix filter: ${keyPrefixFilter}`)
	}

	await connectDirect()

	try {
		if (!onlyMoments) {
			await migrateMediaDocuments()
		}
		if (!onlyMedia) {
			await migrateMomentImageUrls()
		}

		console.log('Normalization completed')
		console.log(JSON.stringify(stats, null, 2))
	} finally {
		await mongoose.connection.close()
	}
	process.exit(0)
}

main().catch(error => {
	stats.errors += 1
	console.error('normalizeImageExtensions failed:', error)
	console.log(JSON.stringify(stats, null, 2))
	process.exit(1)
})
