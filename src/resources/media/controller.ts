/* eslint-disable @typescript-eslint/naming-convention */
import sharp from 'sharp'
import { ApiError } from '../../utils'
import { type FormDataReq } from '../../utils/types'

import { Media, type MediaType } from './model'
import { User, UserType } from '../user/model'
import { createAvatarImage, getAvatarFilenameResolved, detectImageMimeFromBuffer } from '../../utils/user/helper'
import { checkS3IfFileExists, deleteFromS3, generateS3GetPresignedUrl, uploadBufferToS3 } from '../../utils/aws'
import { config } from '../../constants/config'
import { createHash } from 'node:crypto'
import { Buffer as NodeBuffer } from 'buffer'
import { LeanDocument } from 'mongoose'

const ACCEPTED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/tiff']

const validateAndGetMimeType = (buffer: NodeBuffer, mimeTypeHint?: string): string => {
	// Validate MIME type from buffer detection
	const detectedMime = detectImageMimeFromBuffer(buffer)
	if (!ACCEPTED_IMAGE_MIMES.includes(detectedMime)) {
		throw new Error(`Unsupported image format detected: ${detectedMime}. Supported formats: JPEG, PNG, WebP, HEIC, GIF, TIFF`)
	}
	return detectedMime
}

const buildUploadResponse = (media: any, imagePath: any, presignedUrl: string, presignedAvatarUrl: string) => ({
	success: true,
	data: {
		mediaId: media._id,
		title: media.title,
		description: media.description,
		type: media.type,
		alias: media.alias,
		imagePath,
		presignedUrl,
		presignedAvatarUrl,
	},
	// kept for backward compatibility
	imagePath,
	presignedUrl,
	presignedAvatarUrl,
})

const handleAvatarUpdate = async (userId: string, mediaId: any, user: LeanDocument<UserType>, skipAvatar: boolean, fileBuffer?: NodeBuffer) => {
	if (skipAvatar) {
		console.info('Skipping avatar creation for user:', userId)
		return generateS3GetPresignedUrl(await getAvatarFilenameResolved(userId))
	}
	try {
		await User.findOneAndUpdate({ _id: userId }, { avatar_generated_at: new Date(), profile_image_media_id: mediaId }, { new: true, runValidators: true })
		user.profile_image_media_id = mediaId
	} catch (err: any) {
		console.error('Error updating avatar_generated_at for user:', userId, err)
	}
	return await createAvatarImage(user, fileBuffer)
}

export const imageUpload = async (req: FormDataReq, res: any, next: any) => {
	try {
		if (!req.file) {
			next(ApiError.badRequest('Either image or type not specified', 'imageUpload'))
			return
		}
		if (!req.requester?._id) {
			next(ApiError.badRequest('Requester ID is missing', 'imageUpload'))
			return
		}
		const user = req.requester
		const userId = String(user._id)
		const { skip_avatar = '', train_avatar = '', force_avatar = '', title, description, type = 'image', alias } = req.query
		const skipAvatar = skip_avatar.trim().toLowerCase() === 'true' || train_avatar.trim().toLowerCase() === 'false' || false // support both skip_avatar and train_avatar for backward compatibility
		const forceAvatar = force_avatar.trim().toLowerCase() === 'true'
		const digestId = createHash('sha256').update(req.file.buffer).digest('hex')

		const duplicateMedia = await Media.findOne({ digest_id: digestId, user_id: userId })
		console.log('Duplicate media check:', { digestId, userId, duplicateMediaId: duplicateMedia?._id }) // --- IGNORE ---
		if (duplicateMedia) {
			duplicateMedia.title = title || duplicateMedia.title
			duplicateMedia.description = description || duplicateMedia.description
			duplicateMedia.type = type || duplicateMedia.type
			duplicateMedia.alias = alias || duplicateMedia.alias
			if (duplicateMedia.train_avatar !== !skipAvatar && !skipAvatar) {
				console.log('Updating train_avatar for duplicate media:', duplicateMedia._id, 'to', !skipAvatar) // --- IGNORE ---
				await Media.updateMany({ user_id: userId, train_avatar: true }, { train_avatar: false }).catch((err: any) =>
					console.error('Error updating train_avatar for user:', userId, err),
				)
				duplicateMedia.train_avatar = !skipAvatar
				await duplicateMedia.save().catch((err: any) => console.error('Error updating train_avatar for media:', duplicateMedia._id, err))
				const presignedAvatarUrl = await handleAvatarUpdate(userId, duplicateMedia._id, user, skipAvatar)
				const presignedUrl = generateS3GetPresignedUrl(duplicateMedia.filename || '')
				return res.status(200).send(buildUploadResponse(duplicateMedia, duplicateMedia.path, presignedUrl, presignedAvatarUrl))
			}
			console.log('Duplicate media found, skipping upload and processing:', duplicateMedia._id) // --- IGNORE ---
			const presignedUrl = generateS3GetPresignedUrl(duplicateMedia.filename || '')
			const avatarFilename = await getAvatarFilenameResolved(userId)
			const avatarExists = !forceAvatar && (await checkS3IfFileExists(config.s3.bucketName, avatarFilename))
			const presignedAvatarUrl = avatarExists ? generateS3GetPresignedUrl(avatarFilename) : await handleAvatarUpdate(userId, duplicateMedia._id, user, skipAvatar)
			duplicateMedia.save().catch((err: any) => console.error('Error updating metadata for duplicate media:', duplicateMedia._id, err))
			return res.status(200).send(buildUploadResponse(duplicateMedia, duplicateMedia.path, presignedUrl, presignedAvatarUrl))
		}
		const numImagesUploaded = await Media.countDocuments({ user_id: userId })
		if (numImagesUploaded >= config.user.media.mediaUploadLimit) {
			next(ApiError.badRequest(`Image upload limit reached (${config.user.media.mediaUploadLimit} media files)`, 'imageUpload'))
			return
		}
		console.log('No duplicate media found, proceeding with upload and processing for user:', userId) // --- IGNORE ---
		// Validate image format from buffer
		const detectedMime = validateAndGetMimeType(req.file.buffer, req.file.mimetype)
		console.log('Image format detected:', detectedMime) // --- IGNORE ---
		// Convert all formats to WebP
		const webpBuffer = await sharp(req.file.buffer).withMetadata().webp({ quality: 85 }).toBuffer()
		const key = `${userId}/${userId}_${Date.now()}.webp`
		const s3UploadResult = await uploadBufferToS3(webpBuffer, 'image/webp', key)
		const presignedUrl = generateS3GetPresignedUrl(key)

		if (!skipAvatar) {
			console.log('Updating train_avatar for new media to', !skipAvatar) // --- IGNORE ---
			await Media.updateMany({ user_id: userId, train_avatar: true }, { train_avatar: false }).catch((err: any) => console.error('Error updating train_avatar for user:', userId, err))
		}
		const media: MediaType = new Media({
			digest_id: digestId,
			user_id: userId,
			title,
			description,
			filename: s3UploadResult.Key,
			path: s3UploadResult.Location,
			alias,
			type,
			train_avatar: !skipAvatar,
		})
		await media.save()
		console.log('Media saved to database with ID:', media._id) // --- IGNORE ---
		const presignedAvatarUrl = await handleAvatarUpdate(userId, media._id, user, skipAvatar, req.file.buffer)
		console.log('Avatar update handled, presigned avatar URL:', presignedAvatarUrl) // --- IGNORE ---
		return res.status(200).send(buildUploadResponse(media, s3UploadResult.Location, presignedUrl, presignedAvatarUrl))
	} catch (error) {
		console.error('Error in imageUpload:', error) // --- IGNORE ---
		next(ApiError.internal(String(error), 'imageUpload'))
	}
}

export const imageDelete = async (req: FormDataReq, res: any, next: any) => {
	try {
		if (!req.params.id) {
			next(ApiError.badRequest('Media ID is missing', 'imageDelete'))
			return
		}
		const mediaId = String(req.params.id)
		const userId = String(req.requester?._id)

		const media = await Media.findOne({ _id: mediaId, user_id: userId })
		if (!media) {
			next(ApiError.notFound('Media not found', 'imageDelete'))
			return
		}
		if (media.filename) {
			await deleteFromS3(`${userId}/${media.filename}`)
		}
		await media.deleteOne({
			_id: mediaId,
			user_id: userId,
		})
		if (String(req.requester?.profile_image_media_id) === mediaId) {
			await User.findOneAndUpdate({ _id: userId }, { profile_image_media_id: null }, { new: true, runValidators: true })
		}

		return res.status(200).send({
			success: true,
			message: 'Media deleted successfully',
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'imageDelete'))
	}
}
