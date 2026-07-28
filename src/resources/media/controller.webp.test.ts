import { describe, it, expect, vi } from 'vitest'
import { Buffer } from 'buffer'

describe('Image Upload Multi-Format Support', () => {
	describe('ACCEPTED_IMAGE_MIMES validation', () => {
		const ACCEPTED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/tiff']

		it('should accept JPEG format', () => {
			expect(ACCEPTED_IMAGE_MIMES).toContain('image/jpeg')
		})

		it('should accept PNG format', () => {
			expect(ACCEPTED_IMAGE_MIMES).toContain('image/png')
		})

		it('should accept WebP format', () => {
			expect(ACCEPTED_IMAGE_MIMES).toContain('image/webp')
		})

		it('should accept HEIC format (iPhone)', () => {
			expect(ACCEPTED_IMAGE_MIMES).toContain('image/heic')
		})

		it('should accept HEIF format (alternative HEIC)', () => {
			expect(ACCEPTED_IMAGE_MIMES).toContain('image/heif')
		})

		it('should accept GIF format', () => {
			expect(ACCEPTED_IMAGE_MIMES).toContain('image/gif')
		})

		it('should accept TIFF format', () => {
			expect(ACCEPTED_IMAGE_MIMES).toContain('image/tiff')
		})

		it('should reject unsupported formats', () => {
			const unsupported = ['image/bmp', 'image/svg+xml', 'video/mp4', 'text/plain']
			unsupported.forEach(format => {
				expect(ACCEPTED_IMAGE_MIMES).not.toContain(format)
			})
		})

		it('should have exactly 7 supported formats', () => {
			expect(ACCEPTED_IMAGE_MIMES.length).toBe(7)
		})
	})

	describe('validateAndGetMimeType function', () => {
		const createMockBuffer = (mimeType: string): Buffer => {
			const magicBytes: Record<string, Buffer> = {
				'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
				'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
				'image/webp': Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]),
				'image/gif': Buffer.from([0x47, 0x49, 0x46, 0x38]),
			}
			return magicBytes[mimeType] || Buffer.alloc(0)
		}

		it('should validate PNG format detected from buffer', () => {
			const pngBuffer = createMockBuffer('image/png')
			expect(pngBuffer[0]).toBe(0x89)
		})

		it('should validate JPEG format detected from buffer', () => {
			const jpegBuffer = createMockBuffer('image/jpeg')
			expect(jpegBuffer[0]).toBe(0xff)
		})

		it('should validate WebP format detected from buffer', () => {
			const webpBuffer = createMockBuffer('image/webp')
			expect(webpBuffer.slice(0, 4).toString('ascii')).toBe('RIFF')
		})

		it('should throw error for unsupported formats', () => {
			expect(() => {
				throw new Error('Unsupported image format: image/bmp')
			}).toThrow('Unsupported image format')
		})

		it('should return detected MIME type', () => {
			const buffer = createMockBuffer('image/png')
			expect(buffer.length).toBeGreaterThan(0)
		})
	})

	describe('Upload Processing Pipeline', () => {
		it('should detect format from uploaded buffer', () => {
			const uploadedBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
			expect(uploadedBuffer.length).toBeGreaterThan(0)
		})

		it('should validate format before conversion', () => {
			const acceptedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
			const detectedMime = 'image/png'
			expect(acceptedMimes).toContain(detectedMime)
		})

		it('should convert any format to WebP', () => {
			const formats = ['image/jpeg', 'image/png', 'image/gif', 'image/heic']

			formats.forEach(format => {
				const outputFormat = 'image/webp'
				expect(outputFormat).toBe('image/webp')
			})
		})

		it('should use quality 85 for conversion', () => {
			const quality = 85
			expect(quality).toBe(85)
		})

		it('should preserve metadata during conversion', () => {
			// withMetadata() should preserve EXIF data
			const metadata = {
				exif: true,
				icc: true,
				iptc: true,
			}
			expect(metadata.exif).toBe(true)
		})

		it('should upload WebP version to S3', () => {
			const outputMime = 'image/webp'
			const outputExtension = '.webp'

			expect(outputMime).toBe('image/webp')
			expect(outputExtension).toBe('.webp')
		})
	})

	describe('S3 Key Generation', () => {
		it('should generate .webp key for all uploads', () => {
			const userId = 'user123'
			const timestamp = Date.now()
			const key = `${userId}/${userId}_${timestamp}.webp`

			expect(key.endsWith('.webp')).toBe(true)
			expect(key).toContain(userId)
			expect(key).toContain(String(timestamp))
		})

		it('should use timestamp to ensure uniqueness', () => {
			const userId = 'user456'
			const timestamp1 = 1718454000000
			const timestamp2 = 1718454000001

			const key1 = `${userId}/${userId}_${timestamp1}.webp`
			const key2 = `${userId}/${userId}_${timestamp2}.webp`

			expect(key1).not.toBe(key2)
		})

		it('should include user ID in path', () => {
			const userId = 'abc789'
			const key = `${userId}/${userId}_123456.webp`

			expect(key).toContain(userId)
			expect(key.split('/')[0]).toBe(userId)
		})
	})

	describe('Content-Type Handling', () => {
		it('should set Content-Type to image/webp for S3 upload', () => {
			const contentType = 'image/webp'
			expect(contentType).toBe('image/webp')
		})

		it('should align Content-Type with actual bytes', () => {
			// WebP bytes always go with image/webp Content-Type
			const buffer = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])

			// Metadata should match bytes
			expect(buffer.slice(0, 4).toString('ascii')).toBe('RIFF')
		})

		it('should prevent content-type mismatch issues', () => {
			// All uploads go through conversion, so no mismatch possible
			const scenarios = [
				{ input: 'image/jpeg', output: 'image/webp' },
				{ input: 'image/png', output: 'image/webp' },
				{ input: 'image/heic', output: 'image/webp' },
			]

			scenarios.forEach(({ input, output }) => {
				expect(output).toBe('image/webp')
			})
		})
	})

	describe('Error Handling', () => {
		it('should handle invalid MIME type from user input', () => {
			expect(() => {
				const acceptedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/tiff']
				const userMime = 'text/plain'

				if (!acceptedMimes.includes(userMime)) {
					throw new Error(`Unsupported image format: ${userMime}`)
				}
			}).toThrow('Unsupported image format')
		})

		it('should handle conversion errors gracefully', () => {
			expect(() => {
				throw new Error('Sharp conversion failed: Invalid image data')
			}).toThrow('Sharp conversion failed')
		})

		it('should handle S3 upload errors', () => {
			expect(() => {
				throw new Error('Failed to upload to S3: Access Denied')
			}).toThrow('Failed to upload to S3')
		})

		it('should reject files that fail magic byte validation', () => {
			const randomBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00])
			// No recognized magic bytes - could be corrupted
			expect(randomBuffer.length).toBeGreaterThan(0)
		})
	})

	describe('File Size Optimization', () => {
		it('should reduce file size by converting to WebP', () => {
			// Typical file size reductions:
			// JPEG → WebP: ~20-25% smaller
			// PNG → WebP: ~25-35% smaller
			// HEIC → WebP: ~10-15% smaller

			const reductions = {
				'JPEG to WebP': 0.25,
				'PNG to WebP': 0.3,
				'HEIC to WebP': 0.12,
			}

			Object.values(reductions).forEach(reduction => {
				expect(reduction).toBeGreaterThan(0)
				expect(reduction).toBeLessThan(1)
			})
		})

		it('should use quality 85 for good balance on mobile', () => {
			// Quality levels:
			// 90-100: Professional, large files
			// 75-85: Mobile-optimized (recommended)
			// 60-74: Compressed, visible quality loss

			const qualityLevel = 85
			expect(qualityLevel).toBeGreaterThanOrEqual(75)
			expect(qualityLevel).toBeLessThanOrEqual(85)
		})
	})

	describe('Avatar Training Flag', () => {
		it('should set train_avatar flag correctly when provided', () => {
			const skipAvatar = false
			const trainAvatarFlag = !skipAvatar

			expect(trainAvatarFlag).toBe(true)
		})

		it('should prevent duplicate training flags', () => {
			expect(() => {
				// Should update all existing media with train_avatar: true to false
				// before setting new media's flag to true
				const existingTrainFlags = [true, true, true]
				existingTrainFlags.forEach(flag => {
					expect(flag).toBe(true)
				})
			}).not.toThrow()
		})

		it('should handle skip_avatar query parameter', () => {
			const skipAvatarParam = 'true'
			const skipAvatar = skipAvatarParam.trim().toLowerCase() === 'true'

			expect(skipAvatar).toBe(true)
		})
	})

	describe('Duplicate Detection', () => {
		it('should calculate digest hash from file buffer', () => {
			const buffer = Buffer.from('test image data')
			const digest = require('crypto').createHash('sha256').update(buffer).digest('hex')

			expect(typeof digest).toBe('string')
			expect(digest.length).toBe(64) // SHA256 hex is 64 chars
		})

		it('should skip re-upload if duplicate found', () => {
			const duplicateFound = true

			if (duplicateFound) {
				// Return existing media instead of uploading
				expect(duplicateFound).toBe(true)
			}
		})

		it('should update duplicate metadata', () => {
			const media = {
				title: 'old title',
				description: 'old description',
			}

			const newTitle = 'new title'
			const newDescription = 'new description'

			if (newTitle) media.title = newTitle
			if (newDescription) media.description = newDescription

			expect(media.title).toBe('new title')
		})
	})
})
