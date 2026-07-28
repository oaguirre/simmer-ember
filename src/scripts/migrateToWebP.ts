import process from 'node:process'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import sharp from 'sharp'
import AWS from 'aws-sdk'
import { logger } from '../utils/logger'

dotenv.config({ path: ['.env', '.production.env', '.development.env'] })
const config = require('../constants/config').config as typeof import('../constants/config').config

// Direct Mongo connection (avoid app-level event listeners)
const connectDirect = async () => {
	if (mongoose.connection.readyState === 1) {
		return
	}
	const mongoUrl =
		process.env.MONGODB_URL ||
		(config.mongoDB.username
			? `mongodb://${config.mongoDB.username}:${encodeURIComponent(String(config.mongoDB.password || ''))}@${config.mongoDB.host}:${config.mongoDB.port}`
			: `mongodb://${config.mongoDB.host}:${config.mongoDB.port}`)

	await mongoose.connect(mongoUrl, {
		dbName: config.mongoDB.dbName,
		tlsCAFile: process.env.MONGODB_TLS_CA_FILE || 'global-bundle.pem',
		retryWrites: true,
		w: 'majority',
	})
}

const s3Client = new AWS.S3({
	accessKeyId: process.env.AWS_TARGET_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || config.s3.accessKeyId,
	secretAccessKey: process.env.AWS_TARGET_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || config.s3.secretAccessKey,
	region: process.env.AWS_TARGET_REGION || process.env.AWS_REGION || config.s3.region,
	signatureVersion: 'v2',
})

interface MigrationStats {
	totalMediaScanned: number
	totalMomentsCanned: number
	totalKeysProcessed: number
	convertedToWebP: number
	alreadyWebP: number
	skippedErrors: number
	updatedMediaDocs: number
	updatedMomentDocs: number
	errors: Array<{ key: string; error: string }>
}

const stats: MigrationStats = {
	totalMediaScanned: 0,
	totalMomentsCanned: 0,
	totalKeysProcessed: 0,
	convertedToWebP: 0,
	alreadyWebP: 0,
	skippedErrors: 0,
	updatedMediaDocs: 0,
	updatedMomentDocs: 0,
	errors: [],
}

const downloadFromS3 = async (key: string, bucket: string): Promise<Buffer> => {
	try {
		const result = await s3Client.getObject({ Bucket: bucket, Key: key }).promise()
		const buffer = result.Body as Buffer
		return buffer
	} catch (error) {
		throw new Error(`Failed to download ${key}: ${error instanceof Error ? error.message : error}`)
	}
}

const uploadToS3 = async (buffer: Buffer, key: string, bucket: string, contentType: string): Promise<void> => {
	try {
		await s3Client
			.putObject({
				Bucket: bucket,
				Key: key,
				Body: buffer,
				ContentType: contentType,
			})
			.promise()
	} catch (error) {
		throw new Error(`Failed to upload ${key}: ${error instanceof Error ? error.message : error}`)
	}
}

const deleteFromS3 = async (key: string, bucket: string): Promise<void> => {
	try {
		await s3Client.deleteObject({ Bucket: bucket, Key: key }).promise()
	} catch (error) {
		throw new Error(`Failed to delete ${key}: ${error instanceof Error ? error.message : error}`)
	}
}

const keyExists = async (key: string, bucket: string): Promise<boolean> => {
	try {
		await s3Client.headObject({ Bucket: bucket, Key: key }).promise()
		return true
	} catch (error: any) {
		if (error.code === 'NotFound' || error.statusCode === 404) {
			return false
		}
		throw error
	}
}

const convertImageToWebP = async (buffer: Buffer, quality: number = 85): Promise<Buffer> => {
	try {
		const webpBuffer = await sharp(buffer).withMetadata().webp({ quality }).toBuffer()
		return webpBuffer
	} catch (error) {
		throw new Error(`Sharp conversion failed: ${error instanceof Error ? error.message : error}`)
	}
}

const convertKeyToWebP = async (key: string, apply: boolean, bucket: string): Promise<{ success: boolean; newKey?: string; oldKey?: string }> => {
	try {
		// Skip if already .webp
		if (key.endsWith('.webp')) {
			stats.alreadyWebP++
			return { success: true }
		}

		// Skip if not an image file
		const imageExtensions = /\.(jpg|jpeg|png|gif|tiff|tif|heic|heif)$/i
		if (!imageExtensions.test(key)) {
			return { success: true }
		}

		logger.info('migrate-webp', `Processing key: ${key}`)
		const imageBuffer = await downloadFromS3(key, bucket)
		const webpBuffer = await convertImageToWebP(imageBuffer, 85)

		const newKey = key.replace(/\.(jpg|jpeg|png|gif|tiff|tif|heic|heif)$/i, '.webp')

		if (apply) {
			// Upload new WebP version
			await uploadToS3(webpBuffer, newKey, bucket, 'image/webp')
			// Delete old version
			if (key !== newKey) {
				await deleteFromS3(key, bucket)
			}
			stats.convertedToWebP++
			logger.info('migrate-webp', `Converted and uploaded: ${key} → ${newKey}`)
		} else {
			stats.convertedToWebP++
			logger.info('migrate-webp', `[DRY-RUN] Would convert: ${key} → ${newKey}`)
		}

		return { success: true, oldKey: key, newKey }
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error)
		stats.skippedErrors++
		stats.errors.push({ key, error: errorMsg })
		logger.warn('migrate-webp', `Error processing ${key}: ${errorMsg}`)
		return { success: false }
	}
}

const migrateMediaDocuments = async (apply: boolean, bucket: string, prefix?: string, limit?: number) => {
	try {
		const Media = (await import('../resources/media/model')).default
		let query: any = {}
		if (prefix) {
			query.filename = { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }
		}

		const mediaDocuments = await Media.find(query)
			.limit(limit || 0)
			.lean()

		for (const media of mediaDocuments) {
			stats.totalMediaScanned++
			if (!media.filename) continue

			const conversion = await convertKeyToWebP(media.filename, apply, bucket)
			if (conversion.success && conversion.newKey && conversion.oldKey && conversion.oldKey !== conversion.newKey) {
				if (apply) {
					// Update Media document with new filename/path
					const newPath = media.path?.replace(conversion.oldKey, conversion.newKey)
					await Media.findByIdAndUpdate(media._id, {
						filename: conversion.newKey,
						path: newPath,
						url: newPath,
					})
					stats.updatedMediaDocs++
					logger.info('migrate-webp', `Updated media document ${media._id} with new filename`)
				}
			}
		}
	} catch (error) {
		logger.error('migrate-webp', `Error migrating media documents: ${error instanceof Error ? error.message : error}`)
	}
}

const migrateMomentImageUrls = async (apply: boolean, bucket: string, prefix?: string, limit?: number) => {
	try {
		const { Moment } = await import('../resources/moment/model')
		const moments = await Moment.find()
			.limit(limit || 0)
			.lean()

		for (const moment of moments) {
			stats.totalMomentsCanned++
			if (!Array.isArray(moment.image_urls) || moment.image_urls.length === 0) continue

			let updated = false
			const newImageUrls: string[] = []

			for (const imageUrl of moment.image_urls) {
				if (!imageUrl || typeof imageUrl !== 'string') {
					newImageUrls.push(imageUrl)
					continue
				}

				const conversion = await convertKeyToWebP(imageUrl, apply, bucket)
				if (conversion.success && conversion.newKey && conversion.oldKey !== conversion.newKey) {
					newImageUrls.push(conversion.newKey)
					updated = true
				} else {
					newImageUrls.push(imageUrl)
				}
			}

			if (updated && apply) {
				await Moment.findByIdAndUpdate(moment._id, { image_urls: newImageUrls })
				stats.updatedMomentDocs++
				logger.info('migrate-webp', `Updated moment document ${moment._id} with new image URLs`)
			}
		}
	} catch (error) {
		logger.error('migrate-webp', `Error migrating moment image URLs: ${error instanceof Error ? error.message : error}`)
	}
}

const listS3Keys = async (bucket: string, prefix?: string): Promise<string[]> => {
	const keys: string[] = []
	let continuationToken: string | undefined

	try {
		do {
			const result = await s3Client
				.listObjectsV2({
					Bucket: bucket,
					Prefix: prefix,
					ContinuationToken: continuationToken,
				})
				.promise()

			if (result.Contents) {
				for (const item of result.Contents) {
					if (item.Key) {
						keys.push(item.Key)
					}
				}
			}

			continuationToken = result.NextContinuationToken
		} while (continuationToken)
	} catch (error) {
		logger.error('migrate-webp', `Error listing S3 keys: ${error instanceof Error ? error.message : error}`)
	}

	return keys
}

const migrateS3DirectKeys = async (apply: boolean, bucket: string, prefix?: string, limit?: number) => {
	try {
		const keys = await listS3Keys(bucket, prefix)
		const keysToProcess = limit ? keys.slice(0, limit) : keys

		for (const key of keysToProcess) {
			stats.totalKeysProcessed++
			await convertKeyToWebP(key, apply, bucket)
		}
	} catch (error) {
		logger.error('migrate-webp', `Error during S3 key migration: ${error instanceof Error ? error.message : error}`)
	}
}

const main = async () => {
	try {
		await connectDirect()
		logger.info('migrate-webp', 'Connected to MongoDB')

		const args = process.argv.slice(2)
		const apply = args.includes('--apply')
		const onlyMedia = args.includes('--only-media')
		const onlyMoments = args.includes('--only-moments')
		const onlyS3 = args.includes('--only-s3')
		const bucket =
			args.find(a => a.startsWith('--bucket='))?.split('=')[1] || process.env.S3_TARGET_BUCKET || process.env.AWS_PROFILES_BUCKET_NAME || config.s3.bucketName || 'simmer-prod'
		const prefix = args.find(a => a.startsWith('--prefix='))?.split('=')[1]
		const limitStr = args.find(a => a.startsWith('--limit='))?.split('=')[1]
		const limit = limitStr ? parseInt(limitStr, 10) : undefined

		const mode = apply ? 'APPLY' : 'DRY-RUN'
		logger.info('migrate-webp', `Starting migration in ${mode} mode`)
		logger.info('migrate-webp', `Bucket: ${bucket}, Prefix: ${prefix || 'all'}, Limit: ${limit || 'none'}`)

		if (!onlyMoments && !onlyS3) {
			logger.info('migrate-webp', 'Starting media document migration...')
			await migrateMediaDocuments(apply, bucket, prefix, limit)
		}

		if (!onlyMedia && !onlyS3) {
			logger.info('migrate-webp', 'Starting moment image URL migration...')
			await migrateMomentImageUrls(apply, bucket, prefix, limit)
		}

		if (!onlyMedia && !onlyMoments) {
			logger.info('migrate-webp', 'Starting S3 direct key migration...')
			await migrateS3DirectKeys(apply, bucket, prefix, limit)
		}

		console.log('\n=== Migration Stats ===')
		console.log(`Total Media Documents Scanned: ${stats.totalMediaScanned}`)
		console.log(`Total Moment Documents Scanned: ${stats.totalMomentsCanned}`)
		console.log(`Total S3 Keys Processed: ${stats.totalKeysProcessed}`)
		console.log(`Images Converted to WebP: ${stats.convertedToWebP}`)
		console.log(`Images Already WebP: ${stats.alreadyWebP}`)
		console.log(`Media Documents Updated: ${stats.updatedMediaDocs}`)
		console.log(`Moment Documents Updated: ${stats.updatedMomentDocs}`)
		console.log(`Errors Skipped: ${stats.skippedErrors}`)

		if (stats.errors.length > 0) {
			console.log(`\nErrors encountered:`)
			stats.errors.slice(0, 10).forEach(err => {
				console.log(`  - ${err.key}: ${err.error}`)
			})
			if (stats.errors.length > 10) {
				console.log(`  ... and ${stats.errors.length - 10} more errors`)
			}
		}

		console.log(`\nMode: ${mode}`)
		if (!apply) {
			console.log('To apply changes, run with --apply flag')
		}

		process.exit(0)
	} catch (error) {
		logger.error('migrate-webp', `Fatal error: ${error instanceof Error ? error.message : error}`)
		console.error(error)
		process.exit(1)
	} finally {
		await mongoose.disconnect()
	}
}

main()
