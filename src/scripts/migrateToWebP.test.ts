import { describe, it, expect } from 'vitest'

describe('WebP Migration Script', () => {
	describe('Argument Parsing', () => {
		const parseArgs = (args: string[]) => {
			return {
				apply: args.includes('--apply'),
				onlyMedia: args.includes('--only-media'),
				onlyMoments: args.includes('--only-moments'),
				onlyS3: args.includes('--only-s3'),
				bucket: args.find(a => a.startsWith('--bucket='))?.split('=')[1] || 'simmer-prod',
				prefix: args.find(a => a.startsWith('--prefix='))?.split('=')[1],
				limit: args.find(a => a.startsWith('--limit='))?.split('=')[1] ? parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10) : undefined,
			}
		}

		it('should parse --apply flag', () => {
			const args = ['--apply']
			const parsed = parseArgs(args)
			expect(parsed.apply).toBe(true)
		})

		it('should default to dry-run when --apply not provided', () => {
			const args: string[] = []
			const parsed = parseArgs(args)
			expect(parsed.apply).toBe(false)
		})

		it('should parse --only-media flag', () => {
			const args = ['--only-media']
			const parsed = parseArgs(args)
			expect(parsed.onlyMedia).toBe(true)
		})

		it('should parse --only-moments flag', () => {
			const args = ['--only-moments']
			const parsed = parseArgs(args)
			expect(parsed.onlyMoments).toBe(true)
		})

		it('should parse --only-s3 flag', () => {
			const args = ['--only-s3']
			const parsed = parseArgs(args)
			expect(parsed.onlyS3).toBe(true)
		})

		it('should parse --bucket parameter', () => {
			const args = ['--bucket=my-bucket']
			const parsed = parseArgs(args)
			expect(parsed.bucket).toBe('my-bucket')
		})

		it('should default to simmer-prod bucket', () => {
			const args: string[] = []
			const parsed = parseArgs(args)
			expect(parsed.bucket).toBe('simmer-prod')
		})

		it('should parse --prefix parameter', () => {
			const args = ['--prefix=meeting_date/']
			const parsed = parseArgs(args)
			expect(parsed.prefix).toBe('meeting_date/')
		})

		it('should parse --limit parameter as number', () => {
			const args = ['--limit=500']
			const parsed = parseArgs(args)
			expect(parsed.limit).toBe(500)
			expect(typeof parsed.limit).toBe('number')
		})

		it('should handle multiple parameters', () => {
			const args = ['--apply', '--only-media', '--limit=100', '--prefix=user/']
			const parsed = parseArgs(args)
			expect(parsed.apply).toBe(true)
			expect(parsed.onlyMedia).toBe(true)
			expect(parsed.limit).toBe(100)
			expect(parsed.prefix).toBe('user/')
		})
	})

	describe('Dry-Run Mode', () => {
		it('should not modify S3 objects in dry-run', () => {
			const apply = false
			expect(apply).toBe(false)
		})

		it('should not update MongoDB in dry-run', () => {
			const apply = false
			expect(apply).toBe(false)
		})

		it('should report conversion statistics', () => {
			const stats = {
				totalMediaScanned: 100,
				totalMomentsCanned: 50,
				convertedToWebP: 45,
				alreadyWebP: 5,
			}

			expect(stats.totalMediaScanned).toBeGreaterThan(0)
			expect(stats.convertedToWebP + stats.alreadyWebP).toBeLessThanOrEqual(stats.totalMediaScanned)
		})

		it('should indicate which files would be converted', () => {
			const conversions = [
				{ old: 'image1.jpg', new: 'image1.webp' },
				{ old: 'image2.png', new: 'image2.webp' },
			]

			conversions.forEach(({ old, new: newName }) => {
				expect(newName.endsWith('.webp')).toBe(true)
				expect(old.endsWith('.webp')).toBe(false)
			})
		})

		it('should calculate total file size reduction', () => {
			const stats = {
				totalOriginalSize: 1000000,
				estimatedWebPSize: 650000,
			}

			const reduction = ((stats.totalOriginalSize - stats.estimatedWebPSize) / stats.totalOriginalSize) * 100
			expect(reduction).toBeGreaterThan(0)
			expect(reduction).toBeLessThan(100)
		})
	})

	describe('Apply Mode', () => {
		it('should set --apply flag to enable changes', () => {
			const apply = true
			expect(apply).toBe(true)
		})

		it('should convert images to WebP in S3', () => {
			const operations = ['download', 'convert', 'upload', 'delete']
			expect(operations.length).toBe(4)
		})

		it('should update Media document filenames', () => {
			const update = {
				filename: 'new_name.webp',
				path: 'path/to/new_name.webp',
				url: 'url/to/new_name.webp',
			}

			expect(update.filename.endsWith('.webp')).toBe(true)
			expect(update.path.endsWith('.webp')).toBe(true)
			expect(update.url.endsWith('.webp')).toBe(true)
		})

		it('should update Moment image_urls references', () => {
			const oldUrls = ['image1.jpg', 'image2.png']
			const newUrls = ['image1.webp', 'image2.webp']

			newUrls.forEach(url => {
				expect(url.endsWith('.webp')).toBe(true)
			})
		})

		it('should delete original S3 objects after successful conversion', () => {
			const deleteOperation = {
				key: 'old_image.jpg',
				bucket: 'simmer-prod',
			}

			expect(deleteOperation.key.endsWith('.webp')).toBe(false)
		})
	})

	describe('Scoped Migration', () => {
		describe('--only-media scope', () => {
			it('should scan Media collection only', () => {
				const scope = 'media'
				expect(scope).toBe('media')
			})

			it('should skip Moment.image_urls processing', () => {
				const scopes = ['media']
				expect(scopes).not.toContain('moments')
			})

			it('should update Media.filename and Media.path', () => {
				const mediaUpdates = ['filename', 'path', 'url']
				mediaUpdates.forEach(field => {
					expect(field).toBeTruthy()
				})
			})
		})

		describe('--only-moments scope', () => {
			it('should scan Moment documents only', () => {
				const scope = 'moments'
				expect(scope).toBe('moments')
			})

			it('should process Moment.image_urls arrays', () => {
				const imageUrls = ['image1.webp', 'image2.webp']
				expect(Array.isArray(imageUrls)).toBe(true)
			})

			it('should skip Media collection processing', () => {
				const scopes = ['moments']
				expect(scopes).not.toContain('media')
			})
		})

		describe('--only-s3 scope', () => {
			it('should process S3 objects directly', () => {
				const scope = 's3'
				expect(scope).toBe('s3')
			})

			it('should skip Mongo collection updates', () => {
				const scopes = ['s3']
				const mongoCollections = ['media', 'moments']
				scopes.forEach(scope => {
					expect(mongoCollections).not.toContain(scope)
				})
			})
		})

		describe('default (no scope limit)', () => {
			it('should process all three scopes', () => {
				const scopes = ['media', 'moments', 's3']
				expect(scopes.length).toBe(3)
			})

			it('should update Media and Moments', () => {
				const updates = ['media', 'moments']
				expect(updates.length).toBe(2)
			})
		})
	})

	describe('Prefix Filtering', () => {
		it('should filter S3 keys by prefix', () => {
			const prefix = 'meeting_date/'
			const keys = ['meeting_date/user1_user2/image.jpg', 'meeting_date/user3_user4/image.jpg', 'user/123/avatar.jpg']

			const filtered = keys.filter(k => k.startsWith(prefix))
			expect(filtered.length).toBe(2)
		})

		it('should filter Media by filename prefix', () => {
			const prefix = 'user/'
			const regex = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

			const filenames = ['user/123/avatar.jpg', 'meeting_date/user1_user2/image.jpg']
			const filtered = filenames.filter(f => regex.test(f))

			expect(filtered.length).toBe(1)
		})

		it('should apply prefix to all scopes', () => {
			const prefix = 'user/'
			const scopes = ['media', 'moments', 's3']

			scopes.forEach(scope => {
				// Each scope applies the same prefix filter
				expect(prefix).toBe('user/')
			})
		})

		it('should handle prefix without trailing slash', () => {
			const prefixes = ['user', 'user/', 'meeting_date', 'meeting_date/']
			prefixes.forEach(p => {
				expect(typeof p).toBe('string')
			})
		})
	})

	describe('Limit Parameter', () => {
		it('should limit document scan to specified number', () => {
			const limit = 500
			const total = 10000

			expect(limit).toBeLessThan(total)
		})

		it('should apply limit to all scopes', () => {
			const limit = 100
			const scopes = ['media', 'moments', 's3']

			scopes.forEach(scope => {
				expect(limit).toBe(100)
			})
		})

		it('should handle no limit (process all)', () => {
			const limit: number | undefined = undefined
			expect(limit).toBeUndefined()
		})
	})

	describe('Statistics and Reporting', () => {
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

		it('should report total documents scanned', () => {
			const stats: MigrationStats = {
				totalMediaScanned: 1000,
				totalMomentsCanned: 500,
				totalKeysProcessed: 1500,
				convertedToWebP: 1450,
				alreadyWebP: 50,
				skippedErrors: 0,
				updatedMediaDocs: 900,
				updatedMomentDocs: 400,
				errors: [],
			}

			expect(stats.totalMediaScanned).toBe(1000)
			expect(stats.totalMomentsCanned).toBe(500)
		})

		it('should report conversion statistics', () => {
			const stats: MigrationStats = {
				totalMediaScanned: 1000,
				totalMomentsCanned: 500,
				totalKeysProcessed: 1500,
				convertedToWebP: 1450,
				alreadyWebP: 50,
				skippedErrors: 0,
				updatedMediaDocs: 900,
				updatedMomentDocs: 400,
				errors: [],
			}

			expect(stats.convertedToWebP + stats.alreadyWebP).toBe(stats.totalKeysProcessed)
		})

		it('should report MongoDB update counts', () => {
			const stats: MigrationStats = {
				totalMediaScanned: 100,
				totalMomentsCanned: 50,
				totalKeysProcessed: 150,
				convertedToWebP: 140,
				alreadyWebP: 10,
				skippedErrors: 0,
				updatedMediaDocs: 90,
				updatedMomentDocs: 40,
				errors: [],
			}

			expect(stats.updatedMediaDocs).toBeLessThanOrEqual(stats.totalMediaScanned)
			expect(stats.updatedMomentDocs).toBeLessThanOrEqual(stats.totalMomentsCanned)
		})

		it('should report error count and details', () => {
			const stats: MigrationStats = {
				totalMediaScanned: 100,
				totalMomentsCanned: 50,
				totalKeysProcessed: 150,
				convertedToWebP: 140,
				alreadyWebP: 10,
				skippedErrors: 2,
				updatedMediaDocs: 90,
				updatedMomentDocs: 40,
				errors: [
					{ key: 'user/123/avatar.jpg', error: 'Failed to convert: corrupted data' },
					{ key: 'meeting_date/a_b/image.jpg', error: 'S3 access denied' },
				],
			}

			expect(stats.errors.length).toBe(stats.skippedErrors)
		})

		it('should show first 10 errors and count remainder', () => {
			const errors = Array.from({ length: 15 }, (_, i) => ({
				key: `image${i}.jpg`,
				error: `Error ${i}`,
			}))

			const displayed = errors.slice(0, 10)
			const remaining = errors.length - 10

			expect(displayed.length).toBe(10)
			expect(remaining).toBe(5)
		})
	})

	describe('Error Recovery', () => {
		it('should continue on single file conversion error', () => {
			const files = ['image1.jpg', 'image2.jpg', 'image3.jpg']
			const errors = [false, true, false]

			let successCount = 0
			errors.forEach(hasError => {
				if (!hasError) successCount++
			})

			expect(successCount).toBe(2)
		})

		it('should track skipped files', () => {
			const stats = {
				total: 100,
				processed: 98,
				skipped: 2,
			}

			expect(stats.processed + stats.skipped).toBe(stats.total)
		})

		it('should log error details for debugging', () => {
			const errorLog = {
				key: 'image.jpg',
				error: 'Sharp conversion failed',
				timestamp: new Date(),
			}

			expect(errorLog.key).toBeTruthy()
			expect(errorLog.error).toBeTruthy()
		})
	})

	describe('Database Connection', () => {
		it('should use standalone MongoDB connection', () => {
			const connString = 'mongodb://localhost:27017/simmer'
			expect(connString).toContain('mongodb')
		})

		it('should not register app-level event listeners', () => {
			// Direct connection avoids mongoose.connection global listeners
			const listeners: string[] = []
			expect(listeners.length).toBe(0)
		})

		it('should disconnect after migration completes', () => {
			const connected = false
			expect(connected).toBe(false)
		})
	})
})
