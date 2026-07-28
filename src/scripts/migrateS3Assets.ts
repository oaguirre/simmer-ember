/* eslint-disable import/first */
import dotenv from 'dotenv'
import process from 'node:process'

dotenv.config({ path: ['.env', `.${process.env.NODE_ENV || 'development'}.env`] })

import AWS from 'aws-sdk'
import mongoose, { type ConnectOptions } from 'mongoose'
import connect from '../utils/db'
import { User } from '../resources/user/model'
import { Relationship } from '../resources/relationship/model'
import { Moment } from '../resources/moment/model'

type AwsEnvConfig = {
	sourceAccessKeyId: string
	sourceSecretKey: string
	targetAccessKeyId: string
	targetSecretKey: string
	sourceBucket: string
	targetBucket: string
	sourceRegion: string
	targetRegion: string
}

type MongoEnvConfig = {
	sourceUri: string
	targetUri: string
	sourceDbName?: string
	targetDbName?: string
}

type MongoConnectionRef = {
	role: 'source' | 'target'
	uri: string
	dbName?: string
	conn: mongoose.Connection
}

type MediaDoc = {
	_id: mongoose.Types.ObjectId | string
	filename?: string
	type?: string
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const overwrite = args.includes('--overwrite')
const userLimitArg = args.find(arg => arg.startsWith('--user-limit='))
const relationshipLimitArg = args.find(arg => arg.startsWith('--relationship-limit='))
const prefixFilterArg = args.find(arg => arg.startsWith('--prefix='))
const mongoOnly = args.includes('--mongo-only')
const s3Only = args.includes('--s3-only')
const clearTarget = args.includes('--clear-target')

const userLimit = userLimitArg ? Number.parseInt(userLimitArg.replace('--user-limit=', ''), 10) : null
const relationshipLimit = relationshipLimitArg ? Number.parseInt(relationshipLimitArg.replace('--relationship-limit=', ''), 10) : null
const prefixFilter = prefixFilterArg ? prefixFilterArg.replace('--prefix=', '').trim() : ''

const getRequiredEnv = (name: string): string => {
	const value = process.env[name]?.trim()
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`)
	}
	return value
}

const isMongoUri = (value: string): boolean => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://')

const buildMongoUriFromHost = (hostEnvName: string, portEnvName: string, usernameEnvName: string, passwordEnvName: string): string => {
	const host = getRequiredEnv(hostEnvName)
	const port = getRequiredEnv(portEnvName)
	const username = process.env[usernameEnvName]
	const password = process.env[passwordEnvName]

	if (username) {
		return `mongodb://${username}:${encodeURIComponent(String(password || ''))}@${host}:${port}/`
	}

	return `mongodb://${host}:${port}/`
}

const buildMongoSourceUri = (): string => {
	if (process.env.MONGO_SOURCE_URI) {
		return process.env.MONGO_SOURCE_URI
	}
	if (process.env.MONGODB_SOURCE_HOST) {
		return buildMongoUriFromHost('MONGODB_SOURCE_HOST', 'MONGODB_SOURCE_PORT', 'MONGODB_SOURCE_USERNAME', 'MONGODB_SOURCE_PASSWORD')
	}
	return buildMongoUriFromHost('MONGODB_HOST', 'MONGODB_PORT', 'MONGODB_USERNAME', 'MONGODB_PASSWORD')
}

const buildMongoTargetUri = (): string => {
	if (process.env.MONGO_TARGET_URI) {
		return process.env.MONGO_TARGET_URI
	}
	if (process.env.MONGODB_TARGET_HOST) {
		return buildMongoUriFromHost('MONGODB_TARGET_HOST', 'MONGODB_TARGET_PORT', 'MONGODB_TARGET_USERNAME', 'MONGODB_TARGET_PASSWORD')
	}
	return buildMongoUriFromHost('MONGODB_HOST', 'MONGODB_PORT', 'MONGODB_USERNAME', 'MONGODB_PASSWORD')
}

const hasAnyMongoSourceConnectionVars = (): boolean => {
	return Boolean(process.env.MONGO_SOURCE_URI || process.env.MONGODB_SOURCE_HOST || (process.env.MONGODB_HOST && process.env.MONGODB_PORT))
}

const hasAnyMongoTargetConnectionVars = (): boolean => {
	return Boolean(process.env.MONGO_TARGET_URI || process.env.MONGODB_TARGET_HOST || (process.env.MONGODB_HOST && process.env.MONGODB_PORT))
}

const loadMongoEnvConfig = (): MongoEnvConfig => {
	const source = getRequiredEnv('MONGO_DB_SOURCE')
	const target = getRequiredEnv('MONGO_DB_TARGET')

	if (isMongoUri(source) && isMongoUri(target)) {
		return {
			sourceUri: source,
			targetUri: target,
		}
	}

	if (isMongoUri(source) !== isMongoUri(target)) {
		throw new Error('MONGO_DB_SOURCE and MONGO_DB_TARGET must both be Mongo URIs or both be database names')
	}

	if (!hasAnyMongoSourceConnectionVars() || !hasAnyMongoTargetConnectionVars()) {
		throw new Error(
			'Mongo DB-name mode requires explicit source and target connection settings. Set MONGO_SOURCE_URI/MONGO_TARGET_URI or MONGODB_SOURCE_HOST/MONGODB_TARGET_HOST (with matching ports and credentials).',
		)
	}

	return {
		sourceUri: buildMongoSourceUri(),
		targetUri: buildMongoTargetUri(),
		sourceDbName: source,
		targetDbName: target,
	}
}

const loadEnvConfig = (): AwsEnvConfig => {
	return {
		sourceAccessKeyId: getRequiredEnv('AWS_SOURCE_ACCESS_KEY_ID'),
		sourceSecretKey: getRequiredEnv('AWS_SOURCE_SECRET_KEY'),
		targetAccessKeyId: getRequiredEnv('AWS_TARGET_ACCESS_KEY'),
		targetSecretKey: getRequiredEnv('AWS_TARGET_SECRET_KEY'),
		sourceBucket: getRequiredEnv('S3_SOURCE_BUCKET') || 'simmer-profs',
		targetBucket: getRequiredEnv('S3_TARGET_BUCKET') || 'simmer-prod',
		sourceRegion: process.env.AWS_SOURCE_REGION || process.env.AWS_REGION || 'us-east-1',
		targetRegion: process.env.AWS_TARGET_REGION || process.env.AWS_REGION || 'us-east-1',
	}
}

const normalizeBucketRegion = (region?: string): string => {
	if (!region || region === 'EU') return 'eu-west-1'
	return region
}

const resolveBucketRegion = async (s3: AWS.S3, bucket: string, fallbackRegion: string): Promise<string> => {
	try {
		const result = await s3
			.getBucketLocation({
				Bucket: bucket,
			})
			.promise()
		return normalizeBucketRegion((result.LocationConstraint as string | undefined) || fallbackRegion)
	} catch {
		return fallbackRegion
	}
}

const createS3Clients = async (config: AwsEnvConfig) => {
	const sourceProbe = new AWS.S3({
		accessKeyId: config.sourceAccessKeyId,
		secretAccessKey: config.sourceSecretKey,
		region: config.sourceRegion,
		signatureVersion: 'v4',
	})
	const sourceRegion = await resolveBucketRegion(sourceProbe, config.sourceBucket, config.sourceRegion)
	const sourceS3 = new AWS.S3({
		accessKeyId: config.sourceAccessKeyId,
		secretAccessKey: config.sourceSecretKey,
		region: sourceRegion,
		signatureVersion: 'v4',
	})

	const targetProbe = new AWS.S3({
		accessKeyId: config.targetAccessKeyId,
		secretAccessKey: config.targetSecretKey,
		region: config.targetRegion,
		signatureVersion: 'v4',
	})
	const targetRegion = await resolveBucketRegion(targetProbe, config.targetBucket, config.targetRegion)
	const targetS3 = new AWS.S3({
		accessKeyId: config.targetAccessKeyId,
		secretAccessKey: config.targetSecretKey,
		region: targetRegion,
		signatureVersion: 'v4',
	})

	return { sourceS3, targetS3, sourceRegion, targetRegion }
}

const listAllKeysForPrefix = async (s3: AWS.S3, bucket: string, prefix: string): Promise<string[]> => {
	const keys: string[] = []
	let continuationToken: string | undefined = undefined

	do {
		const response = await s3
			.listObjectsV2({
				Bucket: bucket,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			})
			.promise()

		for (const item of response.Contents || []) {
			if (item.Key) {
				keys.push(item.Key)
			}
		}

		continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
	} while (continuationToken)

	return keys
}

const assertBucketAccessible = async (s3: AWS.S3, bucket: string, role: 'source' | 'target'): Promise<void> => {
	try {
		await s3
			.headBucket({
				Bucket: bucket,
			})
			.promise()
	} catch (error: any) {
		const code = error?.code || 'UnknownError'
		const statusCode = error?.statusCode || 'n/a'
		throw new Error(`${role} bucket preflight failed for "${bucket}": ${code} (status ${statusCode}). Check bucket name, region, and IAM credentials.`)
	}
}

const objectExists = async (s3: AWS.S3, bucket: string, key: string): Promise<boolean> => {
	try {
		await s3
			.headObject({
				Bucket: bucket,
				Key: key,
			})
			.promise()
		return true
	} catch (error: any) {
		if (error?.code === 'NotFound' || error?.statusCode === 404) {
			return false
		}
		throw error
	}
}

const copyObjectBetweenAccounts = async (sourceS3: AWS.S3, targetS3: AWS.S3, sourceBucket: string, targetBucket: string, key: string): Promise<void> => {
	let sourceObject: AWS.S3.GetObjectOutput
	try {
		sourceObject = await sourceS3
			.getObject({
				Bucket: sourceBucket,
				Key: key,
			})
			.promise()
	} catch (error: any) {
		throw new Error(`getObject failed for ${key}: ${error?.code || error?.message || String(error)}`)
	}

	if (!sourceObject.Body) {
		throw new Error(`Source object body is empty for key: ${key}`)
	}

	try {
		await targetS3
			.putObject({
				Bucket: targetBucket,
				Key: key,
				Body: sourceObject.Body as AWS.S3.Body,
				// Keep migration writes minimal to avoid BadRequest from invalid legacy headers/metadata.
				ContentType: sourceObject.ContentType,
			})
			.promise()
	} catch (error: any) {
		throw new Error(`putObject failed for ${key}: ${error?.code || error?.message || String(error)}`)
	}
}

const copyObjectIfMissing = async (
	sourceS3: AWS.S3,
	targetS3: AWS.S3,
	sourceBucket: string,
	targetBucket: string,
	key: string,
	overwriteExisting: boolean,
): Promise<'copied' | 'skipped-existing'> => {
	if (!overwriteExisting) {
		const exists = await objectExists(targetS3, targetBucket, key)
		if (exists) {
			return 'skipped-existing'
		}
	}

	await copyObjectBetweenAccounts(sourceS3, targetS3, sourceBucket, targetBucket, key)
	return 'copied'
}

const buildUserPrefixes = async (): Promise<string[]> => {
	const users = await User.find({}).select('_id').lean()
	const limitedUsers = userLimit && userLimit > 0 ? users.slice(0, userLimit) : users
	return limitedUsers.map(user => `${String(user._id)}/`)
}

const buildRelationshipPrefixes = async (): Promise<string[]> => {
	const relationships = await Relationship.find({ user_a: { $exists: true }, user_b: { $exists: true } })
		.select('user_a user_b')
		.lean()
	const limitedRelationships = relationshipLimit && relationshipLimit > 0 ? relationships.slice(0, relationshipLimit) : relationships

	const unique = new Set<string>()
	for (const relationship of limitedRelationships) {
		const userA = String((relationship as any).user_a)
		const userB = String((relationship as any).user_b)
		if (!userA || !userB) {
			continue
		}
		unique.add(`meeting_date/${userA}_${userB}/`)
	}

	return Array.from(unique)
}

const extractMeetingDatePrefix = (value?: string): string | null => {
	const rawValue = String(value || '').trim()
	if (!rawValue) {
		return null
	}

	const meetingDateIndex = rawValue.indexOf('meeting_date/')
	if (meetingDateIndex === -1) {
		return null
	}

	const key = rawValue.slice(meetingDateIndex).split('?')[0]
	const lastSlashIndex = key.lastIndexOf('/')
	if (lastSlashIndex === -1) {
		return null
	}

	return key.slice(0, lastSlashIndex + 1)
}

const buildMomentMeetingPrefixes = async (): Promise<string[]> => {
	const moments = await Moment.find({ user_a: { $exists: true }, user_b: { $exists: true } })
		.select('user_a user_b image_urls')
		.lean()

	const unique = new Set<string>()
	for (const moment of moments) {
		const userA = String((moment as any).user_a || '')
		const userB = String((moment as any).user_b || '')
		if (userA && userB) {
			unique.add(`meeting_date/${userA}_${userB}/`)
		}

		for (const imageUrl of Array.isArray((moment as any).image_urls) ? (moment as any).image_urls : []) {
			const prefix = extractMeetingDatePrefix(imageUrl)
			if (prefix) {
				unique.add(prefix)
			}
		}
	}

	return Array.from(unique)
}

const createMongoConnection = async (uri: string, dbName?: string): Promise<mongoose.Connection> => {
	const options: ConnectOptions = {
		...(dbName ? { dbName } : {}),
		tlsCAFile: 'global-bundle.pem',
		serverSelectionTimeoutMS: 30000,
	}
	const conn = mongoose.createConnection(uri, options)
	await conn.asPromise()
	return conn
}

const delay = async (ms: number): Promise<void> => {
	await new Promise(resolve => setTimeout(resolve, ms))
}

const isTransientMongoError = (error: any): boolean => {
	const name = String(error?.name || '')
	const code = String(error?.code || '')
	const message = String(error?.message || '').toLowerCase()

	return (
		name.includes('MongooseServerSelectionError') ||
		name.includes('MongoNetworkError') ||
		name.includes('MongoTopologyClosedError') ||
		code === 'ECONNRESET' ||
		code === 'ENOTFOUND' ||
		code === 'ETIMEDOUT' ||
		message.includes('server selection timed out') ||
		message.includes('topology was destroyed') ||
		message.includes('connection')
	)
}

const reconnectMongoRef = async (ref: MongoConnectionRef): Promise<void> => {
	try {
		await ref.conn.close()
	} catch {
		// ignore close failures when reconnecting
	}
	ref.conn = await createMongoConnection(ref.uri, ref.dbName)
}

const withMongoRetries = async <T>(actionName: string, refs: MongoConnectionRef[], action: () => Promise<T>): Promise<T> => {
	const maxAttempts = 4
	let attempt = 0

	while (true) {
		attempt += 1
		try {
			return await action()
		} catch (error: any) {
			if (!isTransientMongoError(error) || attempt >= maxAttempts) {
				throw error
			}

			console.warn(`Mongo transient error during ${actionName}. Retrying ${attempt}/${maxAttempts - 1}...`, error?.message || error)
			for (const ref of refs) {
				await reconnectMongoRef(ref)
			}
			await delay(Math.min(4000, 500 * attempt))
		}
	}
}

const parseDuplicateInsertCount = (error: any): number => {
	const insertedFromResult = error?.result?.result?.nInserted
	if (typeof insertedFromResult === 'number') {
		return insertedFromResult
	}
	const insertedIds = error?.result?.insertedIds
	if (insertedIds && typeof insertedIds === 'object') {
		return Object.keys(insertedIds).length
	}
	return 0
}

const collectionNames = ['users', 'relationships', 'moments', 'media', 'learnings']
const MIN_VALID_IMAGE_BYTES = Number.parseInt(process.env.MIGRATION_MIN_VALID_IMAGE_BYTES || '256', 10)

const describeMongoEndpoint = (uri: string): string => {
	const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@]+@)?([^/?]+)/i)
	return match?.[1] || 'unknown-host'
}

const isLikelyImageMagic = (bytes: Buffer): boolean => {
	if (!bytes || bytes.length < 4) {
		return false
	}

	// JPEG
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true
	// PNG
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	)
		return true
	// GIF
	if (bytes.length >= 6) {
		const sig = bytes.subarray(0, 6).toString('ascii')
		if (sig === 'GIF87a' || sig === 'GIF89a') return true
	}
	// WEBP (RIFF....WEBP)
	if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return true
	// BMP
	if (bytes[0] === 0x42 && bytes[1] === 0x4d) return true

	return false
}

const readBodyPrefix = (body: AWS.S3.Body): Buffer => {
	if (Buffer.isBuffer(body)) {
		return body
	}
	if (typeof body === 'string') {
		return Buffer.from(body)
	}
	if (body instanceof Uint8Array) {
		return Buffer.from(body)
	}
	return Buffer.alloc(0)
}

const validateTargetImageObject = async (targetS3: AWS.S3, bucket: string, key: string): Promise<{ valid: boolean; reason?: string }> => {
	let head: AWS.S3.HeadObjectOutput
	try {
		head = await targetS3
			.headObject({
				Bucket: bucket,
				Key: key,
			})
			.promise()
	} catch (error: any) {
		return { valid: false, reason: `missing_or_unreadable:${error?.code || 'unknown'}` }
	}

	const contentLength = Number(head.ContentLength || 0)
	if (!Number.isFinite(contentLength) || contentLength < MIN_VALID_IMAGE_BYTES) {
		return { valid: false, reason: `invalid_length:${contentLength}` }
	}

	let sample: AWS.S3.GetObjectOutput
	try {
		sample = await targetS3
			.getObject({
				Bucket: bucket,
				Key: key,
				Range: 'bytes=0-31',
			})
			.promise()
	} catch (error: any) {
		return { valid: false, reason: `sample_read_failed:${error?.code || 'unknown'}` }
	}

	const prefix = readBodyPrefix(sample.Body as AWS.S3.Body)
	if (!isLikelyImageMagic(prefix)) {
		return { valid: false, reason: 'invalid_magic_bytes' }
	}

	return { valid: true }
}

const runTargetMediaIntegrityCheck = async (sourceS3: AWS.S3, targetS3: AWS.S3, sourceBucket: string, targetBucket: string, applyMigration: boolean): Promise<void> => {
	const mongoConfig = loadMongoEnvConfig()
	const targetConn = await createMongoConnection(mongoConfig.targetUri, mongoConfig.targetDbName)
	try {
		const mediaCollection = targetConn.db.collection('media')
		const cursor = mediaCollection.find({ filename: { $exists: true, $ne: '' } }, { projection: { _id: 1, filename: 1, type: 1 }, batchSize: 500 })

		let checked = 0
		let repairedByCopy = 0
		let removedFromTarget = 0
		let failed = 0

		for await (const rawDoc of cursor as any) {
			const doc = rawDoc as MediaDoc
			checked += 1

			if (doc.type && doc.type !== 'image') {
				continue
			}
			const key = String(doc.filename || '').trim()
			if (!key) {
				continue
			}

			const validation = await validateTargetImageObject(targetS3, targetBucket, key)
			if (validation.valid) {
				continue
			}

			console.warn(`[media-check] Invalid target image for media ${String(doc._id)} key=${key} reason=${validation.reason || 'unknown'}. Attempting recopy from source.`)

			let recopySucceeded = false
			if (applyMigration) {
				try {
					await copyObjectBetweenAccounts(sourceS3, targetS3, sourceBucket, targetBucket, key)
					const postValidation = await validateTargetImageObject(targetS3, targetBucket, key)
					recopySucceeded = postValidation.valid
					if (recopySucceeded) {
						repairedByCopy += 1
					}
				} catch (error) {
					console.error(`[media-check] Recopy failed for media ${String(doc._id)} key=${key}:`, error)
				}
			}

			if (recopySucceeded) {
				continue
			}

			failed += 1
			const failureMessage = `[media-check] Unrecoverable media on target for media ${String(doc._id)} key=${key}.`
			if (!applyMigration) {
				console.error(`${failureMessage} Would delete target media document in apply mode.`)
				continue
			}

			await mediaCollection.deleteOne({ _id: doc._id as any })
			removedFromTarget += 1
			console.error(`${failureMessage} Deleted target media document.`)
		}

		console.log('--- Target media integrity check result ---')
		console.log(`Media docs checked: ${checked}`)
		console.log(`Repaired by recopy: ${repairedByCopy}`)
		console.log(`Unrecoverable failures: ${failed}`)
		console.log(`Removed from target media collection: ${removedFromTarget}`)
	} finally {
		await targetConn.close()
	}
}

const migrateMongoCollection = async (
	sourceRef: MongoConnectionRef,
	targetRef: MongoConnectionRef,
	collectionName: string,
	applyMigration: boolean,
): Promise<{ totalSource: number; copied: number; skippedExisting: number; failed: number }> => {
	const sourceCollection = sourceRef.conn.db.collection(collectionName)
	const targetCollection = targetRef.conn.db.collection(collectionName)

	const totalSource = await sourceCollection.countDocuments({})
	let copied = 0
	let skippedExisting = 0
	let failed = 0

	if (totalSource === 0) {
		return { totalSource, copied, skippedExisting, failed }
	}

	const batchSize = 500
	let batch: any[] = []

	const flushBatch = async (): Promise<void> => {
		if (batch.length === 0) {
			return
		}

		const ids = batch.map(doc => doc._id)
		const existing = await targetCollection.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()
		const existingIds = new Set(existing.map(doc => String(doc._id)))
		const missingDocs = batch.filter(doc => !existingIds.has(String(doc._id)))

		skippedExisting += batch.length - missingDocs.length

		if (applyMigration && missingDocs.length > 0) {
			try {
				const result = await targetCollection.insertMany(missingDocs, { ordered: false })
				copied += result.insertedCount || 0
			} catch (error: any) {
				if (error?.code === 11000 || error?.name === 'MongoBulkWriteError') {
					const inserted = parseDuplicateInsertCount(error)
					copied += inserted
					failed += Math.max(0, missingDocs.length - inserted)
				} else {
					failed += missingDocs.length
					throw error
				}
			}
		}

		batch = []
	}

	const cursor = sourceCollection.find({}, { batchSize })
	for await (const doc of cursor as any) {
		batch.push(doc)
		if (batch.length >= batchSize) {
			await flushBatch()
		}
	}

	await flushBatch()

	return { totalSource, copied, skippedExisting, failed }
}

const clearTargetCollections = async (targetConn: mongoose.Connection, applyMigration: boolean): Promise<{ cleared: number; skipped: number }> => {
	let cleared = 0
	let skipped = 0

	for (const collectionName of collectionNames) {
		const collection = targetConn.db.collection(collectionName)
		const total = await collection.countDocuments({})
		if (total === 0) {
			continue
		}

		if (!applyMigration) {
			skipped += total
			continue
		}

		const result = await collection.deleteMany({})
		cleared += result.deletedCount || 0
	}

	return { cleared, skipped }
}

const clearTargetCollectionsWithRetry = async (targetRef: MongoConnectionRef, applyMigration: boolean): Promise<{ cleared: number; skipped: number }> => {
	return await withMongoRetries('clearTargetCollections', [targetRef], async () => await clearTargetCollections(targetRef.conn, applyMigration))
}

const migrateMongoCollectionWithRetry = async (
	sourceRef: MongoConnectionRef,
	targetRef: MongoConnectionRef,
	collectionName: string,
	applyMigration: boolean,
): Promise<{ totalSource: number; copied: number; skippedExisting: number; failed: number }> => {
	return await withMongoRetries(
		`migrateMongoCollection:${collectionName}`,
		[sourceRef, targetRef],
		async () => await migrateMongoCollection(sourceRef, targetRef, collectionName, applyMigration),
	)
}

const runMongoMigration = async (applyMigration: boolean): Promise<void> => {
	const mongoConfig = loadMongoEnvConfig()
	const sourceRef: MongoConnectionRef = {
		role: 'source',
		uri: mongoConfig.sourceUri,
		dbName: mongoConfig.sourceDbName,
		conn: await createMongoConnection(mongoConfig.sourceUri, mongoConfig.sourceDbName),
	}
	const targetRef: MongoConnectionRef = {
		role: 'target',
		uri: mongoConfig.targetUri,
		dbName: mongoConfig.targetDbName,
		conn: await createMongoConnection(mongoConfig.targetUri, mongoConfig.targetDbName),
	}

	console.log('--- MongoDB migration summary ---')
	console.log(`Mode: ${applyMigration ? 'APPLY' : 'DRY-RUN'}`)
	console.log(`Clear target before import: ${clearTarget ? 'yes' : 'no'}`)
	console.log(`Source endpoint: ${describeMongoEndpoint(mongoConfig.sourceUri)}`)
	console.log(`Target endpoint: ${describeMongoEndpoint(mongoConfig.targetUri)}`)
	console.log(`Source DB: ${mongoConfig.sourceDbName || '(from URI)'}`)
	console.log(`Target DB: ${mongoConfig.targetDbName || '(from URI)'}`)
	console.log(`Collections: ${collectionNames.join(', ')}`)

	try {
		if (clearTarget) {
			const result = await clearTargetCollectionsWithRetry(targetRef, applyMigration)
			console.log(`Target clear result: deleted=${result.cleared} skipped_in_dry_run=${result.skipped}`)
			if (!applyMigration) {
				console.log('Clear target is a destructive operation. Re-run with --apply to delete target documents.')
				return
			}
		}

		for (const collectionName of collectionNames) {
			const result = await migrateMongoCollectionWithRetry(sourceRef, targetRef, collectionName, applyMigration)
			console.log(`Collection ${collectionName}: source=${result.totalSource} copied=${result.copied} skipped_existing=${result.skippedExisting} failed=${result.failed}`)
		}
	} finally {
		await sourceRef.conn.close()
		await targetRef.conn.close()
	}

	if (!applyMigration) {
		console.log('Mongo dry-run complete. Re-run with --apply to insert missing documents.')
	}
}

const runS3Migration = async (): Promise<void> => {
	const envConfig = loadEnvConfig()
	const { sourceS3, targetS3, sourceRegion, targetRegion } = await createS3Clients(envConfig)

	await assertBucketAccessible(sourceS3, envConfig.sourceBucket, 'source')
	await assertBucketAccessible(targetS3, envConfig.targetBucket, 'target')

	await connect()

	const [userPrefixes, relationshipPrefixes, momentMeetingPrefixes] = await Promise.all([buildUserPrefixes(), buildRelationshipPrefixes(), buildMomentMeetingPrefixes()])
	let allPrefixes = Array.from(new Set([...userPrefixes, ...relationshipPrefixes, ...momentMeetingPrefixes]))

	if (prefixFilter) {
		allPrefixes = allPrefixes.filter(prefix => prefix.startsWith(prefixFilter))
	}

	console.log('--- S3 assets migration summary ---')
	console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
	console.log(`Overwrite existing target objects: ${overwrite ? 'yes' : 'no'}`)
	console.log(`Source bucket: ${envConfig.sourceBucket}`)
	console.log(`Source region: ${sourceRegion}`)
	console.log(`Target bucket: ${envConfig.targetBucket}`)
	console.log(`Target region: ${targetRegion}`)
	console.log(`User prefixes: ${userPrefixes.length}`)
	console.log(`Relationship prefixes: ${relationshipPrefixes.length}`)
	console.log(`Moment meeting prefixes: ${momentMeetingPrefixes.length}`)
	console.log(`Total prefixes selected: ${allPrefixes.length}`)

	if (allPrefixes.length === 0) {
		console.log('No prefixes found. Nothing to migrate.')
		return
	}

	let listedObjects = 0
	let copiedObjects = 0
	let skippedExisting = 0
	let failedObjects = 0
	let prefixesWithObjects = 0

	for (const [index, prefix] of allPrefixes.entries()) {
		const keys = await listAllKeysForPrefix(sourceS3, envConfig.sourceBucket, prefix)
		listedObjects += keys.length

		if (keys.length > 0) {
			prefixesWithObjects += 1
		}

		console.log(`[${index + 1}/${allPrefixes.length}] Prefix ${prefix} -> ${keys.length} objects`)

		if (!apply || keys.length === 0) {
			continue
		}

		for (const key of keys) {
			try {
				const result = await copyObjectIfMissing(sourceS3, targetS3, envConfig.sourceBucket, envConfig.targetBucket, key, overwrite)
				if (result === 'skipped-existing') {
					skippedExisting += 1
					continue
				}
				copiedObjects += 1
			} catch (error) {
				failedObjects += 1
				console.error(`Failed to migrate key ${key}:`, error)
			}
		}
	}

	console.log('--- S3 assets migration result ---')
	console.log(`Prefixes scanned: ${allPrefixes.length}`)
	console.log(`Prefixes with objects: ${prefixesWithObjects}`)
	console.log(`Objects found in source: ${listedObjects}`)
	console.log(`Objects copied: ${copiedObjects}`)
	console.log(`Objects skipped (already exist): ${skippedExisting}`)
	console.log(`Objects failed: ${failedObjects}`)

	await runTargetMediaIntegrityCheck(sourceS3, targetS3, envConfig.sourceBucket, envConfig.targetBucket, apply)

	if (!apply) {
		console.log('Dry-run complete. Re-run with --apply to copy objects.')
	}
}

const run = async (): Promise<void> => {
	if (mongoOnly && s3Only) {
		throw new Error('Cannot use --mongo-only and --s3-only together')
	}

	if (!s3Only) {
		await runMongoMigration(apply)
	}

	if (!mongoOnly) {
		await runS3Migration()
	}
}

run()
	.then(() => {
		process.exit(0)
	})
	.catch(error => {
		console.error('Asset migration failed:', error)
		process.exit(1)
	})
