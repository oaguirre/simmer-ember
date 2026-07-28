import dotenv from 'dotenv'
dotenv.config({ path: '../../../.env.test.local' })
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { imageUpload } from './controller'
import { User } from '../user/model'
import { Media } from './model'
import { uploadBufferToS3, generateS3GetPresignedUrl } from '../../utils/aws'
import { createAvatarImage, detectImageMimeFromBuffer } from '../../utils/user/helper'
import { ApiError } from '../../utils'
import { config } from '../../constants/config'
import sharp from 'sharp'

vi.mock('./model.ts', () => {
	class MockMediaInstance {
		_id = 'media123'
		save = vi.fn().mockResolvedValue({})
	}

	// Vitest 4.x requires class syntax for constructor mocks
	const MockMedia = vi.fn()
	MockMedia.mockImplementation(MockMediaInstance)

	// Attach static methods to the constructor
	;(MockMedia as any).countDocuments = vi.fn()
	;(MockMedia as any).updateMany = vi.fn()
	;(MockMedia as any).findOne = vi.fn()
	;(MockMedia as any).findOneAndUpdate = vi.fn()

	return {
		Media: MockMedia,
		default: MockMedia,
	}
})
vi.mock('../user/model')
vi.mock('../../utils/aws')
vi.mock('../../utils/user/helper')
vi.mock('../../utils')
vi.mock('../../constants/config')
vi.mock('sharp')

describe('imageUpload', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		req = {
			file: {
				buffer: Buffer.from('fake-image-data'),
				mimetype: 'image/jpeg',
				originalname: 'test.jpg',
			},
			query: {},
			requester: { _id: '69f8d15fc353a737a7cbaa5d' },
		}
		res = {
			status: vi.fn().mockReturnThis(),
			send: vi.fn(),
		}
		next = vi.fn()

		vi.clearAllMocks()

		const mockSharp = {
			withMetadata: vi.fn().mockReturnThis(),
			webp: vi.fn().mockReturnThis(),
			resize: vi.fn().mockReturnThis(),
			jpeg: vi.fn().mockReturnThis(),
			toBuffer: vi.fn().mockResolvedValue(Buffer.from('processed-image')),
		}
		vi.mocked(sharp).mockReturnValue(mockSharp as any)

		vi.mocked(uploadBufferToS3).mockResolvedValue({
			Key: '69f8d15fc353a737a7cbaa5d/69f8d15fc353a737a7cbaa5d.webp',
			Location: 'https://s3.amazonaws.com/bucket/69f8d15fc353a737a7cbaa5d/69f8d15fc353a737a7cbaa5d.webp',
		} as any)
		vi.mocked(generateS3GetPresignedUrl).mockReturnValue('https://presigned-url.com/image.jpg')
		vi.mocked(createAvatarImage).mockResolvedValue('https://avatar-url.com/avatar.jpg')
		vi.mocked(detectImageMimeFromBuffer).mockReturnValue('image/jpeg')

		vi.spyOn(Media, 'countDocuments').mockResolvedValue(0)
		vi.spyOn(Media, 'updateMany').mockResolvedValue({ acknowledged: true } as any)
		vi.spyOn(Media, 'findOne').mockResolvedValue(null)

		vi.spyOn(User, 'findOneAndUpdate').mockResolvedValue({} as any)

		vi.mocked(config).user = { media: { mediaUploadLimit: 10 } } as any
	})

	it('should upload image successfully with avatar creation', async () => {
		await imageUpload(req, res, next)

		expect(Media.countDocuments).toHaveBeenCalledWith({ user_id: '69f8d15fc353a737a7cbaa5d' })
		expect(sharp).toHaveBeenCalledWith(req.file.buffer)
		expect(uploadBufferToS3).toHaveBeenCalled()
		expect(generateS3GetPresignedUrl).toHaveBeenCalled()
		expect(Media.updateMany).toHaveBeenCalledWith({ user_id: '69f8d15fc353a737a7cbaa5d', train_avatar: true }, { train_avatar: false })
		expect(createAvatarImage).toHaveBeenCalledWith(req.requester, expect.any(Buffer))
		expect(User.findOneAndUpdate).toHaveBeenCalledWith(
			{ _id: '69f8d15fc353a737a7cbaa5d' },
			{ avatar_generated_at: expect.any(Date), profile_image_media_id: 'media123' },
			{ new: true, runValidators: true },
		)
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.send).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				data: expect.objectContaining({
					mediaId: 'media123',
					imagePath: 'https://s3.amazonaws.com/bucket/69f8d15fc353a737a7cbaa5d/69f8d15fc353a737a7cbaa5d.webp',
					presignedUrl: 'https://presigned-url.com/image.jpg',
					presignedAvatarUrl: 'https://avatar-url.com/avatar.jpg',
				}),
			}),
		)
		expect(next).not.toHaveBeenCalled()
	})

	it('should skip avatar creation when skip_avatar is true', async () => {
		req.query.skip_avatar = 'true'
		await imageUpload(req, res, next)

		expect(Media.updateMany).not.toHaveBeenCalled()
		expect(createAvatarImage).not.toHaveBeenCalled()
		expect(User.findOneAndUpdate).not.toHaveBeenCalled()
		expect(res.send).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				data: expect.objectContaining({
					presignedAvatarUrl: 'https://presigned-url.com/image.jpg',
				}),
			}),
		)
	})

	it('should handle missing file', async () => {
		req.file = null

		await imageUpload(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('Either image or type not specified', 'imageUpload'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.send).not.toHaveBeenCalled()
	})

	it('should handle sharp processing error', async () => {
		const sharpError = new Error('Sharp processing failed')
		const mockSharp = {
			resize: vi.fn().mockReturnThis(),
			jpeg: vi.fn().mockReturnThis(),
			toBuffer: vi.fn().mockRejectedValue(sharpError),
		}
		vi.mocked(sharp).mockReturnValue(mockSharp as any)

		await imageUpload(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.internal('Sharp processing failed', 'imageUpload'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.send).not.toHaveBeenCalled()
	})

	it('should handle S3 upload error', async () => {
		const s3Error = new Error('S3 upload failed')
		vi.mocked(uploadBufferToS3).mockRejectedValue(s3Error)

		await imageUpload(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.internal('S3 upload failed', 'imageUpload'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.send).not.toHaveBeenCalled()
	})

	it('should handle avatar creation error but still succeed', async () => {
		const avatarError = new Error('Avatar creation failed')
		vi.mocked(createAvatarImage).mockRejectedValue(avatarError)

		await imageUpload(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.internal('Avatar creation failed', 'imageUpload'))
	})

	it('should process image with correct sharp settings', async () => {
		const mockSharp = {
			withMetadata: vi.fn().mockReturnThis(),
			webp: vi.fn().mockReturnThis(),
			resize: vi.fn().mockReturnThis(),
			jpeg: vi.fn().mockReturnThis(),
			toBuffer: vi.fn().mockResolvedValue(Buffer.from('processed-image')),
		}
		vi.mocked(sharp).mockReturnValue(mockSharp as any)

		await imageUpload(req, res, next)

		expect(mockSharp.withMetadata).toHaveBeenCalled()
		expect(mockSharp.webp).toHaveBeenCalledWith({ quality: 85 })
		expect(mockSharp.toBuffer).toHaveBeenCalled()
	})

	it('should handle upload limit reached', async () => {
		vi.spyOn(Media, 'countDocuments').mockResolvedValue(10)

		await imageUpload(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('Image upload limit reached (10 media files)', 'imageUpload'))
		expect(res.status).not.toHaveBeenCalled()
	})

	it('should save media with correct fields', async () => {
		req.query.title = 'Test Title'
		req.query.description = 'Test Description'
		req.query.alias = 'test-alias'

		await imageUpload(req, res, next)

		expect(Media).toHaveBeenCalledWith(
			expect.objectContaining({
				user_id: '69f8d15fc353a737a7cbaa5d',
				title: 'Test Title',
				description: 'Test Description',
				alias: 'test-alias',
				type: 'image',
				train_avatar: true,
			}),
		)
	})

	it('should set train_avatar to false when skip_avatar is true', async () => {
		req.query.skip_avatar = 'true'

		await imageUpload(req, res, next)

		expect(Media).toHaveBeenCalledWith(
			expect.objectContaining({
				train_avatar: false,
			}),
		)
	})

	it('should handle missing requester ID', async () => {
		req.requester._id = undefined

		await imageUpload(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('Requester ID is missing', 'imageUpload'))
	})

	it('should not mutate train_avatar query param when not provided', async () => {
		req.query.skip_avatar = 'false'

		await imageUpload(req, res, next)

		expect(req.query.train_avatar).toBeUndefined()
	})

	it('should update existing train_avatar media to false', async () => {
		await imageUpload(req, res, next)

		expect(Media.updateMany).toHaveBeenCalledWith({ user_id: '69f8d15fc353a737a7cbaa5d', train_avatar: true }, { train_avatar: false })
	})
})
