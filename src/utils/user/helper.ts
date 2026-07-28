import process from 'node:process'
import { LeanDocument } from 'mongoose'
import { Buffer } from 'buffer'
import { addAdditionalQAToInput, avatarPrompts, momentImagePrompts } from '../../resources/matches/prompts'
import { type UserType, defaultQuestions, User } from '../../resources/user/model'
import { client as openAI } from '../../utils/openAI'
import { uploadBufferToS3, generateS3GetPresignedUrl, checkS3IfFileExists } from '../aws'
import { MomentType, Moment } from '../../resources/moment/model'
import Media, { MediaType } from '../../resources/media/model'
import { config } from '../../constants'
import { client as claudeAI } from '../../utils/claudeAI'
import { client as geminiAI } from '../../utils/geminiAI'
import { logger } from '../logger'
import { emberPersonalityPrompt } from '../../resources/matches/emberPrompts'
import { Relationship, type RelationshipType } from '../../resources/relationship/model'

export const RELATIONSHIP_STAGES: RelationshipType['stage'][] = [
	'initial',
	'presented',
	'matched',
	'talking',
	'friends',
	'dating',
	'exclusive',
	'serious_relationship',
	'engaged',
	'married',
	'separated',
	'ended',
]

export const getStageIndex = (stage?: RelationshipType['stage']) => {
	const idx = RELATIONSHIP_STAGES.indexOf(stage || 'initial')
	return idx >= 0 ? idx : 0
}

export const relationshipPairQuery = (userA: string, userB: string) => ({
	$or: [
		{ user_a: userA, user_b: userB },
		{ user_a: userB, user_b: userA },
	],
})

export const syncInRelationshipWith = async (userId: string, previousPartnerId: string | null, nextPartnerId: string | null): Promise<void> => {
	if (previousPartnerId && previousPartnerId !== nextPartnerId) {
		const previousRelationship = await Relationship.findOne(relationshipPairQuery(userId, previousPartnerId))
		if (previousRelationship) {
			const previousRelationshipUpdate: Record<string, unknown> = {
				$unset: {
					anniversary_date: 1,
				},
			}
			if (getStageIndex(previousRelationship.stage) > getStageIndex('friends')) {
				previousRelationshipUpdate.$set = { stage: 'friends' }
			}
			await Relationship.findByIdAndUpdate(previousRelationship._id, previousRelationshipUpdate, { runValidators: true })
		}
	}

	if (!nextPartnerId) {
		return
	}

	const nextRelationship = await Relationship.findOne(relationshipPairQuery(userId, nextPartnerId))
	const stageToSet = nextRelationship && getStageIndex(nextRelationship.stage) >= getStageIndex('exclusive') ? nextRelationship.stage : 'exclusive'
	const anniversaryDateToSet = nextRelationship?.anniversary_date || new Date()
	await Relationship.findOneAndUpdate(
		relationshipPairQuery(userId, nextPartnerId),
		{
			$set: {
				status: 'ongoing',
				stage: stageToSet,
				anniversary_date: anniversaryDateToSet,
				last_interaction: new Date(),
				type: 'dating',
				deletedAt: null,
			},
			$setOnInsert: {
				user_a: userId,
				user_b: nextPartnerId,
				avg_match_score: 0,
				tone_trend: 'neutral',
				short_term_memory: [],
				long_term_memory: [],
			},
		},
		{ upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
	)
}

export interface ImageInfoType {
	dateMeetingPresignedUrl: string
	userApresignedUrl: string
	userBpresignedUrl: string
	inputTokens?: number
	outputTokens?: number
}

export interface SummaryInfoType {
	summary?: {
		summary?: string
		summary_b?: string
		title?: string
		location?: string
		items?: string[]
		mood?: string
		gpt_score?: string
		tone_score?: string
		key_moments?: string[]
		match_score?: string
		final_why?: string | { observations: string[]; insight: string }
		tags?: [string]
		personalityTraits?: string[]
		personalityQuirks?: string[]
		moment?: string
		scene?: string
		reflections?: string[]

		conversational_balance?: string
		conversational_balance_level?: string
		conversational_balance_score?: string | number
		curiosity?: string
		curiosity_level?: string
		curiosity_score?: string | number
		chemistry_signals?: string
		chemistry_signals_level?: string
		chemistry_signals_score?: string | number
		conversation_flow?: string
		conversation_flow_level?: string
		conversation_flow_score?: string | number
		listening_responsiveness?: string
		listening_responsiveness_level?: string
		listening_responsiveness_score?: string | number
		humor_alignment?: string
		humor_alignment_level?: string
		humor_alignment_score?: string | number
		energy_alignment?: string
		energy_alignment_level?: string
		energy_alignment_score?: string | number
		repair_attempts?: string
		repair_attempts_level?: string
		repair_attempts_score?: string | number
		responsiveness?: string
		responsiveness_level?: string
		responsiveness_score?: string | number
		tension_handling?: string
		tension_handling_level?: string
		tension_handling_score?: string | number
		shared_moments?: string
		shared_moments_level?: string
		shared_moments_score?: string | number

		pay_attention_to?: string[]
		compatibility_penalty?: string
		tone_trend?: string
		avg_match_score?: number
		flags?: Array<{
			green: string[]
			yellow: string[]
			red: string[]
		}>
		opening_line?: string
		ending_note?: string
		next_scenarios?: {
			location: string
			scenario_type: string
			description: string
		}[]
	}
	inputTokens?: number
	outputTokens?: number
}

export function updateUserCoreQA(user: UserType, coreQuestions?: string[] | null, coreAnswers?: string[] | null): void {
	if (!coreAnswers || coreAnswers.length === 0) {
		return
	}
	const questionsToAdd = coreQuestions ?? defaultQuestions
	if (questionsToAdd.length !== coreAnswers.length) {
		logger.warn(String(user._id), 'Questions and answers length mismatch — no update performed.')
		return
	}
	if (!user.core_questions) {
		user.core_questions = []
	}
	if (!user.core_answers) {
		user.core_answers = []
	}
	logger.info(String(user._id), 'Updating user core questions and answers:', {
		userId: user._id,
		questionsToAdd,
		coreAnswers,
	})
	questionsToAdd.forEach((question, idx) => {
		const existingIdx = user.core_questions?.indexOf(question) || -1
		if (existingIdx !== -1 && user.core_answers) {
			user.core_answers[existingIdx] = coreAnswers[idx]
		} else {
			// Add new question and answer
			user.core_questions?.push(question)
			user.core_answers?.push(coreAnswers[idx])
		}
	})
	// Find duplicate questions and remove them along with their answers
	const seenQuestions = new Set<string>()
	const uniqueQuestions: string[] = []
	const uniqueAnswers: string[] = []
	user.core_questions.forEach((question, idx) => {
		if (!seenQuestions.has(question)) {
			seenQuestions.add(question)
			uniqueQuestions.push(question)
			uniqueAnswers.push(user.core_answers ? user.core_answers[idx] : '')
		}
	})
	user.core_questions = uniqueQuestions
	user.core_answers = uniqueAnswers
}

export function generateAvatarImageUrl(user: UserType): string {
	const baseUrl = process.env.AVATAR_BASE_URL || 'https://example.com/avatars'
	const defaultAvatar = 'default-avatar.png'
	if (!user?._id) {
		return `${baseUrl}/${defaultAvatar}`
	}
	return `${baseUrl}/${String(user._id)}.png`
}

export async function getProfileImageFilename(user: LeanDocument<UserType>): Promise<string> {
	if (!user) {
		throw new Error('User ID is required to generate profile image filename')
	}
	const resolveExistingImageKey = async (preferredKey: string): Promise<string> => {
		const normalizedPreferred = String(preferredKey || '').trim()
		if (!normalizedPreferred) {
			return normalizedPreferred
		}

		if (await checkS3IfFileExists(config.s3.bucketName, normalizedPreferred)) {
			return normalizedPreferred
		}

		const fallbackCandidates = new Set<string>()
		const withReplacedExt = (key: string, ext: 'webp' | 'jpg' | 'png') => key.replace(/\.[^.\/]+$/i, `.${ext}`)

		if (/\.[^.\/]+$/i.test(normalizedPreferred)) {
			fallbackCandidates.add(withReplacedExt(normalizedPreferred, 'webp'))
			fallbackCandidates.add(withReplacedExt(normalizedPreferred, 'jpg'))
			fallbackCandidates.add(withReplacedExt(normalizedPreferred, 'png'))
		} else {
			fallbackCandidates.add(`${normalizedPreferred}.webp`)
			fallbackCandidates.add(`${normalizedPreferred}.jpg`)
			fallbackCandidates.add(`${normalizedPreferred}.png`)
		}

		fallbackCandidates.delete(normalizedPreferred)

		for (const candidate of fallbackCandidates) {
			if (await checkS3IfFileExists(config.s3.bucketName, candidate)) {
				return candidate
			}
		}

		return normalizedPreferred
	}

	var mediaFilename
	if (user.profile_image_media_id) {
		const media = await Media.findOne({
			_id: typeof user.profile_image_media_id === 'string' ? user.profile_image_media_id : user.profile_image_media_id._id,
		}).lean()
		mediaFilename = media?.filename || ''
	}
	const userId = String(user._id)
	if (!mediaFilename) {
		return await resolveExistingImageKey(`${userId}/${userId}.webp`)
	}
	return await resolveExistingImageKey(mediaFilename)
}

export type ImageFileExtension = 'webp'

type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'heif' | 'gif' | 'tiff'

const ACCEPTED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/tiff']

const detectImageFormatFromBuffer = (buffer: Buffer): ImageFormat => {
	if (buffer.length < 4) return 'jpeg'

	// PNG: 0x89 50 4E 47 0D 0A 1A 0A
	if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
		return 'png'
	}

	// GIF: 0x47 49 46 38
	if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
		return 'gif'
	}

	// WebP: RIFF ... WEBP
	if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
		return 'webp'
	}

	// TIFF (little-endian: 0x49 49 2A 00 or big-endian: 0x4D 4D 00 2A)
	if (
		buffer.length >= 4 &&
		((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) || (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
	) {
		return 'tiff'
	}

	// HEIC/HEIF: ISO Base Media File Format with ftyp + heic/heif
	if (buffer.length >= 12) {
		const ftypSignature = buffer.slice(4, 8).toString('ascii')
		if (ftypSignature === 'ftyp') {
			const brand = buffer.slice(8, 12).toString('ascii')
			if (brand.includes('heic') || brand.includes('heix')) return 'heic'
			if (brand.includes('heif') || brand.includes('heit')) return 'heif'
		}
	}

	// Default to JPEG
	return 'jpeg'
}

const convertImageToWebP = async (buffer: Buffer, quality: number = 85): Promise<Buffer> => {
	const sharp = (await import('sharp')).default
	try {
		const webpBuffer = await sharp(buffer).withMetadata().webp({ quality }).toBuffer()
		return webpBuffer
	} catch (error) {
		logger.error('sharp-convert', `Failed to convert image to WebP: ${error instanceof Error ? error.message : error}`)
		throw error
	}
}

const assertWebPForUpload = (buffer: Buffer, key: string, context: string): void => {
	if (!key.toLowerCase().endsWith('.webp')) {
		throw new Error(`${context}: S3 key must end with .webp, received: ${key}`)
	}
	const mime = detectImageMimeFromBuffer(buffer)
	if (mime !== 'image/webp') {
		throw new Error(`${context}: Expected converted image/webp buffer before upload, received: ${mime}`)
	}
}

const imageMimeToExt = (mime: string): ImageFileExtension => {
	return 'webp'
}

const getMeetingDateImageFilenameBase = (userId1: string, userId2: string, when?: Date): string => {
	return `meeting_date/${userId1}_${userId2}/${userId1}_${userId2}${when ? `_${when.getTime()}` : ''}`
}

const S3_GET_URL_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60

export function getMeetingDateImageFilename(userId1: string, userId2: string, when?: Date): string {
	if (!userId1 || !userId2) {
		throw new Error('Both user IDs are required to generate meeting date image filename')
	}
	return `${getMeetingDateImageFilenameBase(userId1, userId2, when)}.webp`
}

export async function getMeetingDateImagePresignedUrl(userId1: string, userId2: string, when?: Date): Promise<string> {
	// Try with timestamp first, then without
	const keysToTry = [getMeetingDateImageFilename(userId1, userId2, when), getMeetingDateImageFilename(userId1, userId2, undefined)]

	for (const key of keysToTry) {
		if (await checkS3IfFileExists(config.s3.bucketName, key)) {
			return generateS3GetPresignedUrl(key, S3_GET_URL_EXPIRES_IN_SECONDS)
		}
	}

	return ''
}

export function getAvatarFilename(userId: string): string {
	if (!userId) {
		throw new Error('User ID is required to generate avatar filename')
	}
	const avatarFilename = String(userId).split('').reverse().join('')
	return `${userId}/${avatarFilename}.webp`
}

export async function getAvatarFilenameResolved(userId: string): Promise<string> {
	// All avatars are now WebP, direct lookup
	const key = getAvatarFilename(userId)
	if (await checkS3IfFileExists(config.s3.bucketName, key)) {
		return key
	}
	// Fallback to legacy format lookup for migration transition
	const legacyExtensions = ['jpg', 'png'] as const
	for (const ext of legacyExtensions) {
		const legacyKey = `${userId}/${String(userId).split('').reverse().join('')}.${ext}`
		if (await checkS3IfFileExists(config.s3.bucketName, legacyKey)) {
			return legacyKey
		}
	}
	return key
}

type OpenAIUploadableImage = Blob & { name: string; lastModified: number }

const createOpenAIUploadableImage = (content: BlobPart | Buffer, fileName: string, mimeType: 'image/jpeg' | 'image/png' | 'image/webp'): OpenAIUploadableImage => {
	const normalizedContent = Buffer.isBuffer(content) ? new Uint8Array(content) : content
	const blob = new Blob([normalizedContent], { type: mimeType }) as OpenAIUploadableImage
	blob.name = fileName
	blob.lastModified = Date.now()
	return blob
}

export const detectImageMimeFromBuffer = (buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif' | 'image/gif' | 'image/tiff' => {
	const format = detectImageFormatFromBuffer(buffer)
	switch (format) {
		case 'png':
			return 'image/png'
		case 'webp':
			return 'image/webp'
		case 'gif':
			return 'image/gif'
		case 'tiff':
			return 'image/tiff'
		case 'heic':
			return 'image/heic'
		case 'heif':
			return 'image/heif'
		default:
			return 'image/jpeg'
	}
}

export async function createAvatarImage(user: LeanDocument<UserType>, profileImageBuffer?: Buffer): Promise<string> {
	const userId = String(user._id)
	let imageFile: OpenAIUploadableImage
	if (profileImageBuffer) {
		imageFile = createOpenAIUploadableImage(profileImageBuffer, `avatar-input-${userId}.jpg`, 'image/jpeg')
	} else if (user.profile_image_media_id) {
		const profileImageFilename = await getProfileImageFilename(user)
		const presignedUrl = sanitizePresignedUrl(generateS3GetPresignedUrl(profileImageFilename))
		const response = await fetch(presignedUrl)
		if (!response.ok) {
			throw new Error(`Failed to download profile image: ${response.status}`)
		}
		const blob = await response.blob()
		const buffer = Buffer.from(await blob.arrayBuffer())
		const mime = detectImageMimeFromBuffer(buffer)
		const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
		imageFile = createOpenAIUploadableImage(buffer, `avatar-input-${userId}.${ext}`, mime as 'image/jpeg' | 'image/png' | 'image/webp')
	} else {
		throw new Error('No profile image available to generate avatar')
	}

	const imageModelCandidates = ['gpt-image-1', 'gpt-image-2']
	const conditioningPrompt = avatarPrompts.v1_2
	let res: any = null
	let imageBuffer: Buffer | null = null
	let lastModelError: unknown = null

	for (const imageModel of imageModelCandidates) {
		try {
			logger.info(imageModel, 'OpenAI avatar image generation parameters:', JSON.stringify({ model: imageModel, prompt: conditioningPrompt }, null, 2).slice(0, 4000))
			res = await openAI?.images.edit({
				model: imageModel,
				prompt: conditioningPrompt,
				image: imageFile,
				size: '1024x1024',
				quality: 'medium',
				output_format: 'webp',
			})
			logger.info(userId, `OpenAI v2 image date meeting response (${imageModel})`, JSON.stringify(res, null, 2).slice(0, 100))
			imageBuffer = await getImageBufferFromOpenAIv2Response(res)
			if (imageBuffer) {
				break
			}
			lastModelError = new Error(`No image data returned from model ${imageModel}`)
		} catch (error) {
			lastModelError = error
			logger.warn(userId, `OpenAI avatar image generation failed with model ${imageModel}; trying next model if available.`, error instanceof Error ? error.message : error)
		}
	}

	if (!imageBuffer) {
		throw lastModelError || new Error('No image data for avatar returned from OpenAI v2 response')
	}

	logger.info(userId, 'Avatar image data received from OpenAI, converting to WebP and uploading to S3 for user:', user._id)
	const webpBuffer = await convertImageToWebP(imageBuffer, 85)
	const avatarFilePath = getAvatarFilename(userId)
	assertWebPForUpload(webpBuffer, avatarFilePath, 'createAvatarImage')
	await uploadBufferToS3(webpBuffer, 'image/webp', avatarFilePath)
	const avatarPresignedUrl = generateS3GetPresignedUrl(avatarFilePath)
	return avatarPresignedUrl
}

const sanitizePresignedUrl = (url: string): string => {
	if (!url) {
		return ''
	}

	const compact = url
		.replace(/\\n/g, '')
		.replace(/[\r\n\t]/g, '')
		.trim()

	const firstWhitespaceIndex = compact.search(/\s/)
	const candidate = firstWhitespaceIndex >= 0 ? compact.slice(0, firstWhitespaceIndex) : compact

	return candidate.replace(/[;,]+$/, '')
}

const previewUrl = (url: string): string => {
	if (!url) {
		return 'missing'
	}
	const qIndex = url.indexOf('?')
	if (qIndex === -1) {
		return url
	}
	const base = url.slice(0, qIndex)
	return `${base}?...`
}

const getImageBufferFromOpenAIv2Response = async (res: any): Promise<Buffer | null> => {
	const imageBase64 =
		res?.data?.[0]?.b64_json ||
		res?.data?.find((output: any) => output.type === 'image_generation_call')?.result ||
		res?.output?.find((output: any) => output.type === 'image_generation_call')?.result ||
		null
	if (imageBase64) {
		return Buffer.from(imageBase64, 'base64')
	}

	const imageUrl = res?.data?.[0]?.url || null
	if (!imageUrl) {
		return null
	}

	const fetchFn = (globalThis as any).fetch
	if (typeof fetchFn !== 'function') {
		throw new Error('OpenAI v2 returned an image URL but fetch is not available to download it')
	}

	const response = await fetchFn(imageUrl)
	if (!response.ok) {
		throw new Error(`Failed to download OpenAI v2 image from URL: ${response.status}`)
	}

	const arrayBuffer = await response.arrayBuffer()
	return Buffer.from(arrayBuffer)
}

export async function createMomentImageWithOpenAIv2(
	user1: LeanDocument<UserType>,
	user2: LeanDocument<UserType>,
	when: Date,
	journal: string[],
	user1AvatarCreatedAt?: Date,
	user2AvatarCreatedAt?: Date,
): Promise<ImageInfoType | null> {
	const userId1 = user1._id ? String(user1._id) : ''
	const userId2 = user2._id ? String(user2._id) : ''
	if (!userId1 || !userId2) {
		logger.error(userId1 || userId2, 'Both user IDs are required to create dating meet image')
		return null
	}
	const userApresignedUrl = sanitizePresignedUrl(
		user1AvatarCreatedAt ? generateS3GetPresignedUrl(await getAvatarFilenameResolved(userId1)) : generateS3GetPresignedUrl(await getProfileImageFilename(user1)),
	)
	const userBpresignedUrl = sanitizePresignedUrl(
		user2AvatarCreatedAt ? generateS3GetPresignedUrl(await getAvatarFilenameResolved(userId2)) : generateS3GetPresignedUrl(await getProfileImageFilename(user2)),
	)
	const imageModelCandidates = ['gpt-image-2', 'gpt-image-1']
	const resolveSupportedMime = (url: string, blobType?: string): 'image/jpeg' | 'image/png' | 'image/webp' => {
		const normalizedBlobType = String(blobType || '')
			.toLowerCase()
			.trim()
		if (normalizedBlobType === 'image/jpeg' || normalizedBlobType === 'image/jpg') return 'image/jpeg'
		if (normalizedBlobType === 'image/png') return 'image/png'
		if (normalizedBlobType === 'image/webp') return 'image/webp'

		const pathOnly = url.split('?')[0].toLowerCase()
		if (pathOnly.endsWith('.png')) return 'image/png'
		if (pathOnly.endsWith('.webp')) return 'image/webp'
		return 'image/jpeg'
	}

	try {
		const momentImagePrompt = momentImagePrompts.v2_2
		const conditioningPrompt = `${momentImagePrompt.prompt}\n\n${momentImagePrompt.getMomentInformation(journal.join('\n'), user1, user2)}\n\n`
		logger.info(
			'Creating dating meet image with OpenAI v2 for users:',
			`userId1: ${userId1}, userId2: ${userId2}`,
			'with conditioning prompt:',
			JSON.stringify(conditioningPrompt, null, 2).slice(0, 4000),
		)
		const requestFileNonce = `${userId1}-${userId2}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
		let res: any = null
		let imageBuffer: Buffer | null = null
		let lastModelError: unknown = null

		const files = await fetchImageFilesIntoMemory(userApresignedUrl, userBpresignedUrl, resolveSupportedMime, requestFileNonce)

		for (const imageModel of imageModelCandidates) {
			try {
				logger.info(imageModel, 'OpenAI v2 image generation parameters:', JSON.stringify({ model: imageModel, prompt: conditioningPrompt }, null, 2).slice(0, 4000))
				res = await openAI?.images.edit({
					model: imageModel,
					prompt: conditioningPrompt,
					image: files,
					size: '1024x1024',
					quality: 'medium',
					output_format: 'webp',
				})
				logger.info(userId1, `OpenAI v2 image date meeting response (${imageModel})`, JSON.stringify(res, null, 2).slice(0, 100))
				imageBuffer = await getImageBufferFromOpenAIv2Response(res)
				if (imageBuffer) {
					break
				}
				lastModelError = new Error(`No image data returned from model ${imageModel}`)
			} catch (error) {
				lastModelError = error
				logger.warn(userId1, `OpenAI image generation failed with model ${imageModel}; trying next model if available.`, error instanceof Error ? error.message : error)
			}
		}

		if (!imageBuffer) {
			throw lastModelError || new Error('No image data for date returned from OpenAI v2 response')
		}

		logger.info(userId1, 'Image data received from OpenAI v2, converting to WebP and uploading to S3 for users:', userId1, userId2)
		const webpBuffer = await convertImageToWebP(imageBuffer, 85)
		const dateMeetingFilePath = getMeetingDateImageFilename(userId1, userId2, when)
		assertWebPForUpload(webpBuffer, dateMeetingFilePath, 'createMomentImageWithOpenAIv2')
		await uploadBufferToS3(webpBuffer, 'image/webp', dateMeetingFilePath)
		const dateMeetingPresignedUrl = generateS3GetPresignedUrl(dateMeetingFilePath)
		return {
			dateMeetingPresignedUrl,
			userApresignedUrl,
			userBpresignedUrl,
			inputTokens: (res as any)?.usage?.input_tokens || 0,
			outputTokens: (res as any)?.usage?.output_tokens || 0,
		}
	} catch (error) {
		logger.warn(userId1, 'OpenAI v2 image generation failed; falling back to PREVIOUS version responses API', error instanceof Error ? error.message : error)
		return await createMomentImage(user1, user2, when, journal, user1AvatarCreatedAt, user2AvatarCreatedAt)
	}
}

async function fetchImageFilesIntoMemory(
	userApresignedUrl: string,
	userBpresignedUrl: string,
	resolveSupportedMime: (url: string, blobType?: string) => 'image/jpeg' | 'image/png' | 'image/webp',
	requestFileNonce: string,
) {
	return await Promise.all(
		[userApresignedUrl, userBpresignedUrl].map(async (url, i) => {
			const response = await fetch(url)
			if (!response.ok) {
				throw new Error(`Failed to download source image ${i}: ${response.status}`)
			}
			const blob = await response.blob()
			const mime = resolveSupportedMime(url, blob.type)
			const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
			const buffer = Buffer.from(await blob.arrayBuffer())
			return createOpenAIUploadableImage(buffer, `image-${requestFileNonce}-${i}.${ext}`, mime)
		}),
	)
}

export async function createMomentImage(
	user1: LeanDocument<UserType>,
	user2: LeanDocument<UserType>,
	when: Date,
	journal: string[],
	user1AvatarCreatedAt?: Date,
	user2AvatarCreatedAt?: Date,
): Promise<ImageInfoType | null> {
	// Create a minimal user object for getProfileImageFilename
	const userId1 = user1._id ? String(user1._id) : ''
	const userId2 = user2._id ? String(user2._id) : ''
	if (!userId1 || !userId2) {
		logger.error(userId1 || userId2, 'Both user IDs are required to create dating meet image')
		return null
	}

	const userApresignedUrl = sanitizePresignedUrl(
		user1AvatarCreatedAt ? generateS3GetPresignedUrl(await getAvatarFilenameResolved(userId1)) : generateS3GetPresignedUrl(await getProfileImageFilename(user1)),
	)
	const userBpresignedUrl = sanitizePresignedUrl(
		user2AvatarCreatedAt ? generateS3GetPresignedUrl(await getAvatarFilenameResolved(userId2)) : generateS3GetPresignedUrl(await getProfileImageFilename(user2)),
	)
	const momentImagePrompt = momentImagePrompts.v2_2
	logger.info(userId1, 'Creating dating meet image with OpenAI for users:', userId1, userId2, 'with journal:', journal)
	logger.info(userId1, 'User A image URL:', userApresignedUrl)
	logger.info(userId1, 'User B image URL:', userBpresignedUrl)
	const res = await openAI?.responses.create({
		model: 'gpt-4.1',
		input: [
			{
				role: 'user',
				content: [
					{
						type: 'input_text',
						text: momentImagePrompt.prompt.concat('\n\n', momentImagePrompt.getMomentInformation(journal.join('\n'), user1, user2)),
					},
					{
						type: 'input_image',
						image_url: userApresignedUrl,
						detail: 'auto',
					},
					{
						type: 'input_image',
						image_url: userBpresignedUrl,
						detail: 'auto',
					},
				],
			},
		],
		tools: [
			{
				type: 'image_generation',
				quality: 'medium',
				output_format: 'webp',
			},
		],
	})
	// logger.info('OpenAI image date meeting edit response', JSON.stringify(res, null, 2))
	const imageData = res?.output.filter(output => output.type === 'image_generation_call').map(output => (output as any).result)

	if ((imageData?.length || 0) > 0) {
		const imageBase64 = imageData?.[0]
		if (!imageBase64) {
			throw new Error('No base64 image data returned from OpenAI')
		}
		const generatedImageBuffer = Buffer.from(imageBase64, 'base64')
		logger.info(userId1, 'Image data received from OpenAI, converting to WebP and uploading to S3 for users:', userId1, userId2)
		const webpBuffer = await convertImageToWebP(generatedImageBuffer, 85)
		const dateMeetingFilePath = getMeetingDateImageFilename(userId1, userId2, when)
		assertWebPForUpload(webpBuffer, dateMeetingFilePath, 'createMomentImage')
		await uploadBufferToS3(webpBuffer, 'image/webp', dateMeetingFilePath)
		const dateMeetingPresignedUrl = generateS3GetPresignedUrl(dateMeetingFilePath)
		return {
			dateMeetingPresignedUrl,
			userApresignedUrl,
			userBpresignedUrl,
			inputTokens: res?.usage?.input_tokens || 0,
			outputTokens: res?.usage?.output_tokens || 0,
		}
	}
	throw new Error('No image data for date returned from OpenAI response')
}

export function replaceAllowedParametersInSummaryPrompt(
	summaryToUse: { prompt: string; allowedParameters: { [x: string]: { name: any } } },
	parameters: { [key: string]: string | number | boolean | string[] },
): string {
	let updatedPrompt = summaryToUse.prompt
	for (const param in summaryToUse.allowedParameters) {
		const key = summaryToUse.allowedParameters[param].name
		const value = String(parameters[key] || parameters[key.toLocaleUpperCase()])
		// Format:
		// First time if [KEY:Value DEFAULT_MULTILINE_PROMPT_TEXT] if value is not provided in parameters leave KEY: DEFAULT_TEXT, otherwise use KEY: value from parameters]
		// For next occurrences of [KEY:Value DEFAULT_MULTILINE_PROMPT_TEXT ] with '' if value from parameters else leave DEFAULT_TEXT as is
		// For example if prompt is "Describe a date at [LOCATION: beautiful place choosing from cafe or a beach] and [LOCATION: Location has to be cozy]
		// If parameters = { LOCATION: 'cafe' } then result should be "Describe a date at LOCATION: cafe and "
		// If parameters = {} then result should be "Describe a date at LOCATION: beautiful place choosing from cafe or a beach and "Location has to be cozy"
		const regex = new RegExp(`\\[${key}:([^\\s]+)?\\s([^\\]]+)\\]`, 'g')
		var firstTime = true
		updatedPrompt = updatedPrompt.replace(regex, (_match: string, p1: string, p2: string) => {
			if (parameters[key] !== undefined && parameters[key] !== null && parameters[key] !== '') {
				if (firstTime) {
					firstTime = false
					return `${key}: ${value}`
				} else {
					return ``
				}
			} else {
				if (firstTime) {
					firstTime = false
					return `${key}: ${p2}`
				} else {
					return `${p2}`
				}
			}
		})
	}
	return updatedPrompt
}

export function extractParametersFromBody(
	body: any,
	allowedParameters: { name: string; type: string; enum?: string[] }[],
): { [key: string]: string | number | boolean | string[] } {
	const extractedParameters: { [key: string]: string | number | boolean | string[] } = {}
	allowedParameters.forEach(param => {
		if (body[param.name]) {
			extractedParameters[param.name] = body[param.name]
			if (param.type === 'string') {
				const value = String(body[param.name])
				if (param.enum) {
					const sanitizedValue = (value: string) =>
						value
							.toLocaleLowerCase()
							.replace(/\s+/g, '-')
							.replace(/[^a-z0-9\-]/g, '')
					const enums = param.enum.map(e => sanitizedValue(String(e)))
					const validValue = enums.includes(sanitizedValue(value))
					if (!validValue) {
						throw new Error(`Invalid value for parameter ${param.name}. Allowed values are: ${enums.join(', ')}`)
					}
				}
				extractedParameters[param.name] = value
			} else if (param.type === 'number') {
				extractedParameters[param.name] = Number(body[param.name])
			} else if (param.type === 'boolean') {
				extractedParameters[param.name] = body[param.name] === 'true' || body[param.name] === true
			} else if (param.type === 'string[]') {
				var arrayValue: string[] = []
				if (Array.isArray(body[param.name])) {
					arrayValue = body[param.name].map((v: any) => String(v))
				} else if (typeof body[param.name] === 'string') {
					// If it's a double-pipe separated string, split it into an array
					arrayValue = body[param.name].split('||').map((v: string) => v.trim())
				}
				if (param.enum) {
					const sanitizedEnum = (value: string) =>
						value
							.toLocaleLowerCase()
							.replace(/\s+/g, '-')
							.replace(/[^a-z0-9\-]/g, '')
					const enums = param.enum.map(e => sanitizedEnum(String(e)))
					const validValues = arrayValue.every((v: string) => enums.includes(sanitizedEnum(v)))
					if (!validValues) {
						throw new Error(`Invalid value for parameter ${param.name}. Allowed values are: ${enums.join(', ')}`)
					}
				}
				extractedParameters[param.name] = arrayValue.map((v: any) => String(v).slice(0, 256)) // Limit each string to 1024 characters to prevent abuse
			}
		}
	})
	return extractedParameters
}

export async function createMeetingDateSummaryUsingGemini(
	summaryToUse: any,
	journal: string[],
	sourceUser: UserType,
	dateUser: UserType,
	summaryParameters: { [key: string]: string | number | boolean | string[] },
): Promise<SummaryInfoType> {
	const summaryText = replaceAllowedParametersInSummaryPrompt(summaryToUse, summaryParameters)
		.replace(/\[Name\]/g, dateUser.first_name || 'your friend')
		.replace(/\[INJECT_EMBER_PERSONALITY\]/g, emberPersonalityPrompt.v2.prompt || '')
	var inputFromUser = summaryToUse.getUsersInformation ? await summaryToUse.getUsersInformation(sourceUser, dateUser) : ''
	if (inputFromUser) {
		const additionalQuestionsForDate = summaryParameters['QUESTIONS_FOR_DATE'] as string[] | undefined
		const myAnswersForDate = summaryParameters['MY_ANSWERS_FOR_DATE'] as string[] | undefined
		if (additionalQuestionsForDate && additionalQuestionsForDate.length > 0) {
			logger.info(
				String(sourceUser._id),
				'Adding additional Q/A to summary input',
				'questionsCount=',
				additionalQuestionsForDate.length,
				'answersCount=',
				myAnswersForDate?.length || 0,
			)
			logger.info(String(sourceUser._id), 'addAdditionalQAToInput function exists:', typeof addAdditionalQAToInput === 'function')
			inputFromUser = addAdditionalQAToInput(inputFromUser, additionalQuestionsForDate, myAnswersForDate)
		}
	}
	const promptContent = summaryText.concat('\n\n', summaryToUse.requiresTranscript ? journal.join('\n') : '')
	const contents =
		'Build a JSON summary of the following input information:\n\n' +
		(typeof inputFromUser === 'string' ? inputFromUser : `\`\`\`json\n${JSON.stringify(inputFromUser, null, 2)}\n\`\`\``)

	logger.debug(String(sourceUser._id), '[PROMPT] Creating meeting date summary with Gemini', 'segments=', promptContent.length + contents.length)
	try {
		const res = await geminiAI?.models.generateContent({
			model: 'gemini-3-flash-preview',
			contents,
			config: {
				systemInstruction: promptContent,
			},
		})
		logger.debug(
			String(sourceUser._id),
			'Gemini summary response metadata',
			'inputTokens=',
			res?.usageMetadata?.toolUsePromptTokenCount || 0,
			'outputTokens=',
			res?.usageMetadata?.candidatesTokenCount || 0,
		)
		const summaryResponse = res?.text || ''
		const cleanedJSON = summaryResponse.replace(/```json\n?|```/g, '').trim()
		const summaryJSON = safeJsonParse(cleanedJSON)
		logger.debug(String(sourceUser._id), 'Gemini summary parsed successfully:', Boolean(summaryJSON))
		return {
			summary: summaryJSON || {},
			inputTokens: res?.usageMetadata?.toolUsePromptTokenCount || 0,
			outputTokens: res?.usageMetadata?.candidatesTokenCount || 0,
		}
	} catch (error) {
		logger.error(String(sourceUser._id), 'Error creating meeting date summary with Gemini:', error)
		return {
			summary: {},
			inputTokens: 0,
			outputTokens: 0,
		}
	}
}

export async function createMeetingDateSummaryUsingClaude(
	summaryToUse: any,
	journal: string[],
	sourceUser: UserType,
	dateUser: UserType,
	summaryParameters: { [key: string]: string | number | boolean | string[] },
): Promise<SummaryInfoType> {
	const summaryText = replaceAllowedParametersInSummaryPrompt(summaryToUse, summaryParameters)
		.replace(/\[Name\]/g, dateUser.first_name || 'your friend')
		.replace(/\[INJECT_EMBER_PERSONALITY\]/g, emberPersonalityPrompt.v2.prompt || '')
	var inputFromUser = summaryToUse.getUsersInformation ? await summaryToUse.getUsersInformation(sourceUser, dateUser) : ''
	if (inputFromUser) {
		const additionalQuestionsForDate = summaryParameters['QUESTIONS_FOR_DATE'] as string[] | undefined
		const myAnswersForDate = summaryParameters['MY_ANSWERS_FOR_DATE'] as string[] | undefined
		if (additionalQuestionsForDate && additionalQuestionsForDate.length > 0) {
			logger.info(
				String(sourceUser._id),
				'Adding additional Q/A to summary input',
				'questionsCount=',
				additionalQuestionsForDate.length,
				'answersCount=',
				myAnswersForDate?.length || 0,
			)
			logger.info(String(sourceUser._id), 'addAdditionalQAToInput function exists:', typeof addAdditionalQAToInput === 'function')
			inputFromUser = addAdditionalQAToInput(inputFromUser, additionalQuestionsForDate, myAnswersForDate)
		}
	}
	const promptContent: Array<{ type: 'text'; text: string }> = [
		{
			type: 'text' as const,
			text: summaryText,
		},
	]
	if (summaryToUse.requiresTranscript) {
		promptContent.push({
			type: 'text' as const,
			text: journal.join('\n'),
		})
	} else {
		promptContent.push({
			type: 'text' as const,
			text: typeof inputFromUser === 'string' ? inputFromUser : `\`\`\`json\n${JSON.stringify(inputFromUser, null, 2)}\n\`\`\``,
		})
	}
	logger.debug(String(sourceUser._id), '[PROMPT] Creating meeting date summary with Claude', 'segments=', promptContent.length)
	try {
		const res = await claudeAI?.messages.create({
			model: 'claude-sonnet-4-6',
			max_tokens: config.claude.maxTokens,
			messages: [{ role: 'user', content: promptContent }],
		})
		logger.debug(String(sourceUser._id), 'Claude summary response metadata', 'inputTokens=', res?.usage?.input_tokens || 0, 'outputTokens=', res?.usage?.output_tokens || 0)
		// Claude returns content as an array of blocks; we extract the text from the first block
		const summaryResponse = res?.content[0].type === 'text' ? res.content[0].text : ''

		// Strip potential markdown code blocks if the model wrapped the JSON
		const cleanedJSON = summaryResponse.replace(/```json\n?|```/g, '').trim()
		const summaryJSON = safeJsonParse(cleanedJSON)
		logger.debug(String(sourceUser._id), 'Claude summary parsed successfully:', Boolean(summaryJSON))
		return {
			summary: summaryJSON || {},
			inputTokens: res?.usage?.input_tokens || 0,
			outputTokens: res?.usage?.output_tokens || 0,
		}
	} catch (error) {
		logger.error(String(sourceUser._id), 'Error creating meeting date summary with Claude:', error)
		return {
			summary: {},
			inputTokens: 0,
			outputTokens: 0,
		}
	}
}

export async function createMeetingDateSummary(
	summaryToUse: any,
	journal: string[],
	sourceUser: UserType,
	dateUser: UserType,
	summaryParameters: { [key: string]: string | number | boolean | string[] },
): Promise<SummaryInfoType> {
	const summaryText = replaceAllowedParametersInSummaryPrompt(summaryToUse, summaryParameters)
		.replace(/\[Name\]/g, dateUser.first_name || 'your friend')
		.replace(/\[INJECT_EMBER_PERSONALITY\]/g, emberPersonalityPrompt.v1.prompt || '')
	var inputFromUser = summaryToUse.getUsersInformation ? await summaryToUse.getUsersInformation(sourceUser, dateUser) : ''
	if (inputFromUser) {
		const additionalQuestionsForDate = summaryParameters['QUESTIONS_FOR_DATE'] as string[] | undefined
		const myAnswersForDate = summaryParameters['MY_ANSWERS_FOR_DATE'] as string[] | undefined
		if (additionalQuestionsForDate && additionalQuestionsForDate.length > 0) {
			logger.info(
				String(sourceUser._id),
				'Adding additional Q/A to summary input',
				'questionsCount=',
				additionalQuestionsForDate.length,
				'answersCount=',
				myAnswersForDate?.length || 0,
			)
			logger.info(String(sourceUser._id), 'addAdditionalQAToInput function exists:', typeof addAdditionalQAToInput === 'function')
			inputFromUser = addAdditionalQAToInput(inputFromUser, additionalQuestionsForDate, myAnswersForDate)
		}
	}
	const promptContent: Array<{ type: 'input_text'; text: string }> = [
		{
			type: 'input_text' as const,
			text: summaryText,
		},
	]
	if (summaryToUse.requiresTranscript) {
		promptContent.push({
			type: 'input_text' as const,
			text: journal.join('\n'),
		})
	} else {
		promptContent.push({
			type: 'input_text' as const,
			text: typeof inputFromUser === 'string' ? inputFromUser : `\`\`\`json\n${JSON.stringify(inputFromUser, null, 2)}\n\`\`\``,
		})
	}
	logger.debug(String(sourceUser._id), '[PROMPT] Creating meeting date summary with OpenAI', 'segments=', promptContent.length)
	const res = await openAI?.responses.create({
		model: 'gpt-5.4', // Before gpt-4.1
		input: [
			{
				role: 'user',
				content: promptContent,
			},
		],
	})
	logger.debug(String(sourceUser._id), 'OpenAI summary response metadata', 'inputTokens=', res?.usage?.input_tokens || 0, 'outputTokens=', res?.usage?.output_tokens || 0)
	const content = res?.output.filter(output => output.type === 'message').map(output => (output as any).content)
	const summary = content?.[0].filter((item: any) => item && item.type === 'output_text').map((itemText: any) => itemText.text)
	logger.debug(String(sourceUser._id), 'OpenAI summary parsed successfully:', Boolean(summary?.[0]))
	const summaryResponse = summary?.[0] || '{"summary": "", "location": "", "title": "", "items": [], "mood": ""}'
	const summaryJSON = safeJsonParse(summaryResponse.replace(/```json\n/g, '').replace(/```/g, ''))
	return {
		summary: summaryJSON || {},
		inputTokens: res?.usage?.input_tokens || 0,
		outputTokens: res?.usage?.output_tokens || 0,
	}
}

/**
 * Attempts to clean and repair a JSON-like string so it can be parsed safely.
 */
export function safeJsonParse<T = any>(input: string): T | null {
	try {
		// 1. Trim whitespace and cut off extra text before/after first valid JSON block
		const firstBrace = input.indexOf('{')
		const firstBracket = input.indexOf('[')
		const firstPos = firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket)
		if (firstPos > 0) {
			input = input.slice(firstPos)
		}

		// Remove trailing non-JSON garbage
		const lastBrace = input.lastIndexOf('}')
		const lastBracket = input.lastIndexOf(']')
		const lastPos = Math.max(lastBrace, lastBracket)
		if (lastPos !== -1) {
			input = input.slice(0, lastPos + 1)
		}
		// 2. Remove \n and multiple spacing
		input = input.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()

		// 3. Remove comments (// ... or /* ... */)
		input = input.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

		// 4. Replace single quotes with double quotes (naive, but works for most LLM outputs)
		// It's not working properly for OpenAI
		// input = input.replace(/'/g, '\"')

		// 5. Remove trailing commas in objects/arrays
		input = input.replace(/,\s*([}\]])/g, '$1')

		// 6. Escape unescaped newlines and tabs inside strings
		input = input.replace(/([^\\])\n/g, '$1\\n').replace(/([^\\])\t/g, '$1\\t')

		// 7. Fix backslashes that aren't valid escape sequences
		input = input.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')

		return JSON.parse(input) as T
	} catch (err) {
		logger.error('-', 'Failed to parse JSON:', err, 'inputLength=', input.length)
		return null
	}
}

export const formatUserForResponse = (user: UserType) => {
	return {
		_id: user._id,
		first_name: user.first_name,
		last_name: user.last_name,
		age: getAgeFromDOB(user.date_of_birth),
		gender: user.gender,
		loc_city: user.loc_city,
		loc_state: user.loc_state,
		loc_country: user.loc_country,
		loc_postal_code: user.loc_postal_code,
		drinking: user.drinking,
		political_view: user.political_view,
		have_kids: user.have_kids,
		want_kids: user.want_kids,
		smoking: user.smoking,
		cannabis: user.cannabis,
		culture: user.culture,
		activities: user.activities,
		education: user.education,
		education_school: user.education_school,
		job: user.job,
		religion: user.religion,
		pets: user.pets,
		have_pets: user.have_pets,
		height: user.height,
		deal_break_lightning: user.deal_break_lightning,
		high_priority_values: user.high_priority_values,
		about: user.about,
		languages: user.languages,
		core_questions: user.core_questions,
		core_answers: user.core_answers,
		presignedAvatarUrl: generateS3GetPresignedUrl(getAvatarFilename(String(user._id))),
	}
}

export const formatUserForExploreResponse = (user: UserType, distanceMiles: number | null = null) => {
	return {
		_id: user._id,
		first_name: user.first_name,
		age: getAgeFromDOB(user.date_of_birth),
		gender: user.gender,
		loc_city: user.loc_city,
		loc_state: user.loc_state,
		loc_country: user.loc_country,
		loc_postal_code: user.loc_postal_code,
		drinking: user.drinking,
		political_view: user.political_view,
		distanceMiles,
		presignedAvatarUrl: generateS3GetPresignedUrl(getAvatarFilename(String(user._id))),
	}
}

export const formatMeetingDateUserForResponse = async (date: MomentType, userA?: UserType, userB?: UserType) => {
	if (!userA && !userB) {
		userA = (await Moment.findOne({ _id: date.user_a }).lean()) as any
		userB = (await Moment.findOne({ _id: date.user_b }).lean()) as any
	}
	return {
		_id: date._id,
		user_a: formatUserForResponse(userA!),
		user_b: formatUserForResponse(userB!),
		model: date.model,
		provider: date.provider,
		type: date.type,
		universe: date.universe,
		source: date.source,
		private_to_a: date.private_to_a,
		tone_score: date.tone_score,
		match_score: date.match_score,
		summary_a: date.summary_a,
		summary_b: date.summary_b,
		journal_a: date.journal_a,
		journal_b: date.journal_b,
		tags: date.tags,
		items: date.items,
		title: date.title,
		location: date.location,
		mood: date.mood,
		next_scenarios: date.next_scenarios,
		final_why: date.final_why,
		input_tokens: date.input_tokens,
		output_tokens: date.output_tokens,
		version: date.version,
		createdAt: date.createdAt,
		updatedAt: date.updatedAt,
	}
}

export function getAgeFromDOB(date_of_birth: Date | undefined) {
	return date_of_birth ? Math.floor((Date.now() - new Date(date_of_birth).getTime()) / 3.15576e10) : null
}

export const normalizeHeightToCentimeters = (value: unknown): number | undefined => {
	const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN
	if (!Number.isFinite(numericValue)) {
		return undefined
	}

	// Values below 50 are interpreted as imperial feet and converted to centimeters.
	const centimeters = numericValue < 50 ? numericValue * 30.48 : numericValue
	return Math.round(centimeters)
}

export const populateMediaToUser = (user: UserType) => {
	const { media } = user
	if (!media || media.length === 0) {
		return user
	}
	return {
		// remove date_of_birth from the returned user object for privacy reasons
		...user,
		date_of_birth: undefined,
		media: media.map((item: MediaType) => ({
			...item,
			presignedUrl: generateS3GetPresignedUrl(String(item.filename)),
		})),
	}
}

export const validatePreferences = (preferences: any) => {
	// For now we only allow preferences to have a "date_ideas" array of strings, but this can be expanded in the future
	if (!preferences || typeof preferences !== 'object') {
		return undefined
	}
	const toEnumArray = (value: unknown, allowed: string[]): string[] | undefined => {
		const values = Array.isArray(value) ? value : value !== undefined && value !== null ? [value] : []
		if (values.length === 0) return undefined
		const validValues = values.filter((v): v is string => typeof v === 'string' && allowed.includes(v))
		return validValues.length > 0 ? validValues : undefined
	}

	return {
		age_min: typeof preferences.age_min === 'number' ? preferences.age_min : undefined,
		age_max: typeof preferences.age_max === 'number' ? preferences.age_max : undefined,
		distance_max: typeof preferences.distance_max === 'number' ? preferences.distance_max : undefined,
		height_min: normalizeHeightToCentimeters(preferences.height_min),
		height_max: normalizeHeightToCentimeters(preferences.height_max),
		exercise: toEnumArray(preferences.exercise, ['unanswered', 'daily', 'few_times_per_week', 'once_per_week', 'occasionally', 'rarely', 'never']),
		have_kids: toEnumArray(preferences.have_kids, ['unanswered', 'no', 'yes', 'prefer_not_to_say']),
		smoking: toEnumArray(preferences.smoking, ['unanswered', 'regularly', 'socially', 'rarely', 'never']),
		cannabis: toEnumArray(preferences.cannabis, ['unanswered', 'regularly', 'socially', 'rarely', 'never', 'sober']),
		relationship_structure: toEnumArray(preferences.relationship_structure, [
			'unanswered',
			'long_term_relationship',
			'short_term_relationship',
			'casual_dating',
			'new_friends',
			'prefer_not_to_say',
		]),
		drinking: toEnumArray(preferences.drinking, ['unanswered', 'regularly', 'socially', 'rarely', 'never', 'sober']),
		political_view: toEnumArray(preferences.political_view, ['unanswered', 'liberal', 'conservative', 'moderate', 'libertarian', 'apolitical']),
		pets: toEnumArray(preferences.pets, ['unanswered', 'dog', 'cat', 'other', 'none']),
	}
}

export const isValidUserIdFormat = (userId: any): boolean => {
	if (typeof userId !== 'string') {
		return false
	}
	const objectIdRegex = /^[a-fA-F0-9]{24}$/
	return objectIdRegex.test(userId)
}
