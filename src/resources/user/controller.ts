/* eslint-disable @typescript-eslint/naming-convention */
import { ApiError } from '../../utils'
import { DEFAULT_MAX_DATE_OF_BIRTH_AGE_YEARS, isDateOfBirthInAllowedRange, parseDateOfBirthInput } from '../../utils/helper'
import { logger } from '../../utils/logger'
import { type Req } from '../../utils/types'

import { User, type UserType } from './model'
import { matchingPrompts, summaryPrompts } from '../matches/prompts'
import {
	populateMediaToUser,
	createMomentImage,
	getAvatarFilenameResolved,
	getProfileImageFilename,
	type ImageInfoType,
	type SummaryInfoType,
	updateUserCoreQA,
	extractParametersFromBody,
	createAvatarImage,
	createMeetingDateSummary,
	validatePreferences,
	normalizeHeightToCentimeters,
	getAgeFromDOB,
	isValidUserIdFormat,
	syncInRelationshipWith,
	createMomentImageWithOpenAIv2,
	createMeetingDateSummaryUsingClaude,
	createMeetingDateSummaryUsingGemini,
} from '../../utils/user/helper'
import { deleteFromS3, generateS3GetPresignedUrl, checkS3IfFileExists } from '../../utils/aws'
import { parseAImodelResponse, storeMoment } from '../moment/controller'
import { Moment, MomentTypeEnum, type MomentType } from '../moment/model'
import { buildAffinityPipeline, buildWorstDatePipeline, get2LetterCodeForState, type BuildAffinityOptions } from '../../utils/user/exploreMatches'
import * as momentUtils from '../../utils/user/moment'
import Media, { MediaType } from '../media/model'
import { Relationship } from '../relationship/model'
import { LeanDocument } from 'mongoose'
import { config } from '../../constants'
import { createOrUpdateRelationshipsForPresentedDates } from '../../utils/user/relationship'
import { removeMomentIdsFromLearnings } from '../../utils/user/learning'
import { toPublicUser, toSelfUser } from '../../utils/user/serializers'
import Learning from '../learning/model'
import { client as geminiAI } from '../../utils/geminiAI'
import { client as claudeAI } from '../../utils/claudeAI'

const MIN_WEIGHT_LBS = 50
const MAX_WEIGHT_LBS = 700

export const countProfiles = async (req: Req, res: any, next: any) => {
	try {
		const count = await User.countDocuments({})
		res.status(200).json({
			success: true,
			data: {
				user_count: count,
			},
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'countProfiles'))
	}
}

export const viewProfile = async (req: Req, res: any, next: any) => {
	try {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		let user_target = (req.query as any)?.user_target || (req as any).params.user_target
		const requesterId = String(req.requester?._id || '')
		if (!user_target) {
			user_target = requesterId
			if (!user_target) {
				next(ApiError.badRequest('No target specified', 'viewProfile'))
				return
			}
		}
		const isSameUser = String(user_target) === requesterId
		if (!isValidUserIdFormat(user_target)) {
			next(ApiError.badRequest('Not valid profile ID', 'viewProfile'))
			return
		}
		const user = await User.findOne({ _id: user_target })
			.select(
				isSameUser
					? ['-password', '+email', '+phone', '+loc_latitude', '+loc_longitude', '+loc_address', '+loc_postal_code', '+date_of_birth']
					: [
							'-password',
							'-username',
							'-email',
							'-phone',
							'-is_admin',
							'-plan',
							'-plan_expires_at',
							'-loc_latitude',
							'-loc_longitude',
							'-loc_address',
							'-loc_postal_code',
							'-last_name',
							'+date_of_birth',
							'-education_school',
							'-job',
							'-born_location',
						],
			)
			.populate<{ media: [MediaType] }>('media')
			.lean()
		if (!user) {
			next(ApiError.notFound('User not found', 'viewProfile'))
			return
		}
		const presignedUrl = generateS3GetPresignedUrl(await getProfileImageFilename(user as any))
		const safeUser = isSameUser ? toSelfUser(user as UserType) : toPublicUser(user as UserType)
		const data = {
			...populateMediaToUser(safeUser as UserType),
			age: getAgeFromDOB(user.date_of_birth),
			presignedUrl,
			presignedAvatarUrl: user.avatar_generated_at ? generateS3GetPresignedUrl(await getAvatarFilenameResolved(String(user._id))) : null,
		}
		res.status(200).json({
			success: true,
			data,
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'viewProfile'))
	}
}

export const updateProfile = async (req: Req, res: any, next: any) => {
	try {
		const {
			first_name,
			last_name,
			username,
			gender,
			genders_to_date,
			is_test_user,
			is_banned,
			aesthetics,
			email,
			phone,
			height,
			weight_lbs,
			have_kids,
			want_kids,
			cannabis,
			smoking,
			relationship_structure,
			pets,
			have_pets,
			faith_importance,
			location_radius,
			vaccination_stance,
			deal_break_lightning,
			loc_latitude,
			loc_longitude,
			loc_address,
			loc_city,
			loc_state,
			loc_country,
			loc_postal_code,
			drinking,
			exercise,
			culture,
			education,
			education_school,
			job,
			religion,
			activities,
			political_view,
			about,
			languages,
			date_of_birth,
			in_relationship_with,
			born_location,
			high_priority_values,
			core_questions,
			core_answers,
			preferences,
		} = req.body
		if (!req.requester?._id) {
			next(ApiError.badRequest('Not all required values were provided', 'updateProfile'))
			return
		}
		const user = await User.findOne({ _id: req.requester._id })
		if (!user) {
			next(ApiError.notFound('User not found', 'updateProfile'))
			return
		}
		const hasBodyField = (field: string) => Object.prototype.hasOwnProperty.call(req.body, field)
		if (hasBodyField('core_questions') || hasBodyField('core_answers')) {
			updateUserCoreQA(user, core_questions, core_answers)
		}
		const previousPartnerId = user.in_relationship_with ? String(user.in_relationship_with) : null
		let nextPartnerId: string | null = previousPartnerId
		if (hasBodyField('in_relationship_with')) {
			if (in_relationship_with === null || in_relationship_with === '') {
				nextPartnerId = null
			} else if (typeof in_relationship_with === 'string') {
				if (!isValidUserIdFormat(in_relationship_with)) {
					next(ApiError.badRequest('in_relationship_with has wrong format', 'updateProfile'))
					return
				}
				nextPartnerId = in_relationship_with
			} else {
				next(ApiError.badRequest('in_relationship_with must be a valid user id or null', 'updateProfile'))
				return
			}

			if (nextPartnerId && nextPartnerId === String(req.requester._id)) {
				next(ApiError.badRequest('in_relationship_with cannot reference yourself', 'updateProfile'))
				return
			}

			if (nextPartnerId) {
				const partnerExists = await User.exists({ _id: nextPartnerId })
				if (!partnerExists) {
					next(ApiError.notFound('in_relationship_with user not found', 'updateProfile'))
					return
				}
			}
		}
		const country = loc_country ? loc_country.toUpperCase() : loc_country
		const normalizedEmail = typeof email === 'string' ? email.toLowerCase() : email
		const normalizedHeight = normalizeHeightToCentimeters(height)
		let weightLbsNumber: number | undefined
		if (hasBodyField('weight_lbs') && weight_lbs != null) {
			weightLbsNumber = Number(weight_lbs)
			const isValidWeight = typeof weightLbsNumber === 'number' && Number.isFinite(weightLbsNumber) && weightLbsNumber >= MIN_WEIGHT_LBS && weightLbsNumber <= MAX_WEIGHT_LBS
			if (!isValidWeight) {
				next(ApiError.badRequest(`weight_lbs must be a number between ${MIN_WEIGHT_LBS} and ${MAX_WEIGHT_LBS}`, 'updateProfile'))
				return
			}
		}
		const parsedDateOfBirth = hasBodyField('date_of_birth') && date_of_birth != null ? parseDateOfBirthInput(date_of_birth) : null
		if (hasBodyField('date_of_birth') && date_of_birth != null && (!parsedDateOfBirth || !isDateOfBirthInAllowedRange(parsedDateOfBirth, DEFAULT_MAX_DATE_OF_BIRTH_AGE_YEARS))) {
			next(
				ApiError.badRequest(
					`date_of_birth must be a valid date (string date format or epoch timestamp), cannot be in the future, and cannot be more than ${DEFAULT_MAX_DATE_OF_BIRTH_AGE_YEARS} years ago`,
					'updateProfile',
				),
			)
			return
		}
		const profileUpdates: Record<string, unknown> = {}
		if (hasBodyField('core_questions') || hasBodyField('core_answers')) {
			profileUpdates.core_questions = user.core_questions
			profileUpdates.core_answers = user.core_answers
		}
		const setIfProvided = (field: string, value: unknown) => {
			if (hasBodyField(field)) {
				profileUpdates[field] = value
			}
		}

		setIfProvided('first_name', first_name)
		setIfProvided('last_name', last_name)
		setIfProvided('gender', gender)
		setIfProvided('genders_to_date', genders_to_date)
		setIfProvided('is_test_user', is_test_user)
		setIfProvided('is_banned', is_banned)
		setIfProvided('aesthetics', aesthetics)
		setIfProvided('username', username)
		setIfProvided('email', normalizedEmail)
		setIfProvided('phone', phone)
		setIfProvided('height', normalizedHeight)
		setIfProvided('weight_lbs', weightLbsNumber)
		setIfProvided('have_kids', have_kids)
		setIfProvided('want_kids', want_kids)
		setIfProvided('smoking', smoking)
		setIfProvided('cannabis', cannabis)
		setIfProvided('relationship_structure', relationship_structure)
		setIfProvided('pets', pets)
		setIfProvided('have_pets', have_pets)
		setIfProvided('activities', activities)
		setIfProvided('faith_importance', faith_importance)
		setIfProvided('location_radius', location_radius)
		setIfProvided('vaccination_stance', vaccination_stance)
		setIfProvided(
			'deal_break_lightning',
			deal_break_lightning
				? deal_break_lightning
						.filter((val: string) => val && val.trim() !== '')
						.map((val: string) =>
							val
								.trim()
								.toLowerCase()
								.replace(/[^a-zA-Z0-9 ]/g, ''),
						)
				: undefined,
		)
		setIfProvided('loc_latitude', loc_latitude)
		setIfProvided('loc_longitude', loc_longitude)
		setIfProvided('loc_address', loc_address)
		setIfProvided('loc_city', loc_city)
		setIfProvided('loc_state', loc_state?.length > 2 ? get2LetterCodeForState(country, loc_state.toUpperCase()) || loc_state : loc_state)
		setIfProvided('loc_country', country)
		setIfProvided('loc_postal_code', loc_postal_code)
		setIfProvided('drinking', drinking)
		setIfProvided('political_view', political_view)
		setIfProvided('about', about)
		setIfProvided('languages', languages)
		setIfProvided('date_of_birth', parsedDateOfBirth ?? date_of_birth)
		if (hasBodyField('in_relationship_with')) {
			profileUpdates.in_relationship_with = nextPartnerId
		}
		setIfProvided('born_location', born_location)
		setIfProvided(
			'high_priority_values',
			high_priority_values
				? high_priority_values
						.filter((val: string) => val && val.trim() !== '')
						.map((val: string) =>
							val
								.trim()
								.toLowerCase()
								.replace(/[^a-zA-Z0-9 ]/g, ''),
						)
				: undefined,
		)
		setIfProvided('exercise', exercise)
		setIfProvided('culture', culture)
		setIfProvided('education', education)
		setIfProvided('education_school', education_school)
		setIfProvided('job', job)
		setIfProvided('religion', religion)
		setIfProvided('preferences', validatePreferences(preferences))
		const updatedUser = await User.findOneAndUpdate({ _id: req.requester._id }, profileUpdates, { new: true, runValidators: true }).select(
			'-password +email +phone +loc_latitude +loc_longitude +loc_address +loc_postal_code +date_of_birth',
		)
		if (hasBodyField('in_relationship_with')) {
			await syncInRelationshipWith(String(req.requester._id), previousPartnerId, nextPartnerId)
		}
		const safeUpdatedUser = toSelfUser(updatedUser as any)
		return res.status(200).send({
			success: true,
			data: {
				...safeUpdatedUser,
				age: getAgeFromDOB((updatedUser as any)?.date_of_birth),
			},
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'updateProfile'))
	}
}

export const getModelProviderForSummary = (summary: any) => {
	const defaultValue = {
		model: config.openAI.model,
		provider: 'openai',
	}
	switch (config.summaryAImodelProvider.toLowerCase()) {
		case 'claude':
			return claudeAI
				? {
						model: config.claude.model,
						provider: 'claude',
					}
				: defaultValue
		case 'gemini':
			return geminiAI
				? {
						model: 'gemini-3-flash-preview',
						provider: 'gemini',
					}
				: defaultValue
		default:
			return defaultValue
	}
}

const pickCreateMeetingDateSummaryFunction = () => {
	switch ((config.summaryAImodelProvider || '').toLowerCase()) {
		case 'claude':
			return claudeAI ? createMeetingDateSummaryUsingClaude : createMeetingDateSummary
		case 'gemini':
			return geminiAI ? createMeetingDateSummaryUsingGemini : createMeetingDateSummary
		default:
			return createMeetingDateSummary
	}
}

export const createMomentWithUser = async (req: Req, res: any, next: any) => {
	try {
		const { user_target, email, matchingPromptVersion = 'v3_2', summaryPromptVersion = 'v7_1', type = 'date' } = (req as any).query
		const normalizePromptVersion = (value: unknown, fallback: string): string => {
			const raw = String(value ?? fallback)
				.trim()
				.toLowerCase()
			if (!raw) {
				return fallback
			}
			if (/^v[\w.]+$/.test(raw)) {
				return raw
			}
			if (/^[\w.]+$/.test(raw)) {
				return `v${raw}`
			}
			return fallback
		}
		const resolvedSummaryPromptVersion = normalizePromptVersion(summaryPromptVersion, 'v7_1')
		const resolvedMatchingPromptVersion = normalizePromptVersion(matchingPromptVersion, 'v3_2')
		const rawSkipDateImage = (req as any).query?.skip_date_image ?? (req as any).query?.skip_image
		const skip_date_image =
			rawSkipDateImage === undefined || rawSkipDateImage === null ? true : typeof rawSkipDateImage === 'string' ? rawSkipDateImage === 'true' : rawSkipDateImage === true
		momentUtils.validateDateRequest(req, user_target as string)
		const user = await momentUtils.validateDateTargetUser(user_target as string, email as string | undefined)
		// console.debug('Date target user validated:', user_target, user)
		const summaryToUse = summaryPrompts[resolvedSummaryPromptVersion as keyof typeof summaryPrompts] || summaryPrompts.v7_1
		if (!summaryPrompts[resolvedSummaryPromptVersion as keyof typeof summaryPrompts]) {
			logger.warn(req.requester?._id, `Unknown summaryPromptVersion "${String(summaryPromptVersion)}" (normalized: "${resolvedSummaryPromptVersion}"). Falling back to v4.`)
		}
		const summaryParameters = extractParametersFromBody(req.body, summaryToUse.allowedParameters)
		const matchingPromptToUse = matchingPrompts[resolvedMatchingPromptVersion as keyof typeof matchingPrompts] || matchingPrompts.v3_2
		if (!matchingPrompts[resolvedMatchingPromptVersion as keyof typeof matchingPrompts]) {
			logger.warn(req.requester?._id, `Unknown matchingPromptVersion "${String(matchingPromptVersion)}" (normalized: "${resolvedMatchingPromptVersion}"). Falling back to v3_2.`)
		}
		// console.debug(
		// 	'Creating date with user_target:',
		// 	user_target,
		// 	'using summaryPromptVersion:',
		// 	summaryPromptVersion,
		// 	'and matchingPromptVersion:',
		// 	matchingPromptVersion,
		// 	summaryToUse,
		// )
		const aiResult = await momentUtils.processAIDateResponse(summaryToUse, matchingPromptToUse, req.requester as UserType, user as UserType)
		let { reply = '', claudeResponse, openAIResponse } = aiResult as any
		let parsedResponse = reply ? parseAImodelResponse(reply) : { journal: [], gptScore: '0', toneScore: '0', matchScore: '0', tags: [] }
		const when = new Date()
		const { journal = [] } = parsedResponse
		const createMeetingDateSummaryFunction = pickCreateMeetingDateSummaryFunction()

		let [momentImage, summary] = await Promise.all([
			!skip_date_image && journal.length > 0
				? createMomentImageWithOpenAIv2(req.requester, user, when, journal, req.requester.avatar_generated_at, user.avatar_generated_at).catch(error => {
						logger.warn(req.requester?._id, 'Dating meet image creation failed or was skipped.', error instanceof Error ? error.stack : error)
						return null
					})
				: null,
			createMeetingDateSummaryFunction(summaryToUse, journal, req.requester as UserType, user as UserType, summaryParameters).catch(error => {
				logger.warn(req.requester?._id, 'Meeting date summary creation failed or was skipped.', error instanceof Error ? error.stack : error)
				return null
			}),
		])
		// Provide fallback for dating meet image if not created above
		if (journal.length === 0 && !skip_date_image) {
			logger.warn(req.requester?._id, 'Dating meet image creation failed or was skipped.')
			const aStringSummary = summary?.summary?.summary || ''
			const aNewJournal = aStringSummary ? aStringSummary.split('. ').slice(0, 3) : []
			momentImage = await createMomentImageWithOpenAIv2(req.requester, user, when, aNewJournal, req.requester.avatar_generated_at, user.avatar_generated_at).catch(error => {
				logger.warn(req.requester?._id, 'Dating meet image creation fallback failed or was skipped.', error instanceof Error ? error.stack : error)
				return null
			})
		}
		const meetingUrls: ImageInfoType[] = momentImage ? [momentImage] : []

		if (!reply) {
			reply = '```json\n' + JSON.stringify({ ...(summary?.summary || {}), journal }) + '```'
			parsedResponse = parseAImodelResponse(reply)
		}
		let moment: LeanDocument<MomentType> | null = null
		let momentStorageError: unknown = null
		try {
			moment = await storeMoment(
				parsedResponse,
				claudeResponse?.usage?.input_tokens || openAIResponse?.usage?.input_tokens || (summary as SummaryInfoType | null)?.inputTokens || 0,
				claudeResponse?.usage?.output_tokens || openAIResponse?.usage?.output_tokens || (summary as SummaryInfoType | null)?.outputTokens || 0,
				req.requester,
				user,
				meetingUrls,
				summary,
				when,
				`summaryPrompt=${resolvedSummaryPromptVersion},matchingPrompt=${resolvedMatchingPromptVersion}`,
				type as MomentTypeEnum,
			)
		} catch (error) {
			momentStorageError = error
			logger.error(req.requester?._id, 'Error storing dating meet:', error)
		}

		if (!moment) {
			throw ApiError.internal(`Failed to persist dating meet${momentStorageError ? `: ${String(momentStorageError)}` : ''}`, 'createMomentWithUser')
		}

		const response = await momentUtils.buildDateResponse(user as UserType, reply, moment, meetingUrls, summary as SummaryInfoType, req.requester as UserType)
		res.status(200).json(response)
	} catch (error) {
		logger.error(req.requester?._id, 'Error in createMomentWithUser:', error instanceof Error ? error.stack : error)
		next(ApiError.internal(String(error), 'createMomentWithUser'))
	}
}

export const processAvatarIfNeeded = async (user: LeanDocument<UserType>) => {
	const avatarFilename = await getAvatarFilenameResolved(String(user._id))
	const avatarExists = await checkS3IfFileExists(config.s3.bucketName, avatarFilename)
		.then(() => true)
		.catch(() => false)
	if (!avatarExists) {
		await createAvatarImage(user)
	}
}

export const createMomentImageOnly = async (req: Req, res: any, next: any) => {
	try {
		const { dating_meet_id, moment_id, user_target: initialUserTarget } = req.query
		momentUtils.validateImageRequest(req, initialUserTarget as string, moment_id as string, dating_meet_id as string)
		const result = await momentUtils.findMoment(dating_meet_id || (moment_id as string), initialUserTarget as string, String(req.requester._id)).catch(error => {
			logger.error(req.requester?._id, 'Error finding dating meet:', error)
			res.status(400).send(ApiError.badRequest('Invalid dating meet id or user target', 'createMomentImageOnly'))
			return null
		})
		if (!result) {
			return
		}
		const { existingMeet, user_target } = result
		if (!isValidUserIdFormat(user_target)) {
			throw ApiError.badRequest('Wrong user_target ID format', 'createMomentImageOnly')
		}
		const user = await User.findOne({ _id: user_target }).populate<{ profile_image_media_id: MediaType }>('profile_image_media_id')
		if (!user) {
			throw ApiError.notFound('User not found', 'createMomentImageOnly')
		}
		const journal = existingMeet.summary_a
			? [existingMeet.summary_a]
			: existingMeet.journal_a || [
					'Went to a cozy little cafe and had an amazing time chatting over coffee.',
					'Took a walk in the park and enjoyed the beautiful weather together.',
					'Had a fun and adventurous time exploring the city and trying new foods.',
				]
		await processAvatarIfNeeded(req.requester) // Ensure avatars are up to date before creating the image
		const when = existingMeet.when || new Date()
		const meetingImage = await createMomentImageWithOpenAIv2(req.requester, user, when, journal, req.requester.avatar_generated_at, user.avatar_generated_at)
		if (!meetingImage) {
			throw ApiError.internal('Failed to create dating meet image', 'createMomentImageOnly')
		}
		const imageFilename = momentUtils.trimPathOnly(meetingImage.dateMeetingPresignedUrl)
		const imageAlreadyExists = await momentUtils.updateMeetWithImage(existingMeet, imageFilename)
		res.status(200).json(await momentUtils.buildImageResponse(meetingImage, existingMeet, imageAlreadyExists, req.requester, user))
	} catch (error) {
		logger.error(req.requester?._id, 'Error in createMomentImageOnly:', error)
		next(ApiError.internal(String(error), 'createMomentImageOnly'))
	}
}

const resolveMomentProfileImageMediaId = (moment: any, requesterId: string): string | null => {
	const raw = moment?.profile_image_media_id
	if (!raw) {
		return null
	}
	if (typeof raw === 'string') {
		return raw
	}
	if (typeof raw === 'object') {
		if (raw._id) {
			return String(raw._id)
		}
		const requesterScoped = raw[requesterId]
		if (typeof requesterScoped === 'string') {
			return requesterScoped
		}
		if (requesterScoped?._id) {
			return String(requesterScoped._id)
		}
	}
	return null
}

export const recreateAvatar = async (req: Req, res: any, next: any) => {
	try {
		const requesterId = String(req.requester?._id || '')
		if (!requesterId) {
			next(ApiError.badRequest('Not all required values were provided', 'recreateAvatar'))
			return
		}

		const user = await User.findOne({ _id: requesterId }).lean()
		if (!user) {
			next(ApiError.notFound('User not found', 'recreateAvatar'))
			return
		}

		const momentId = String(req.query?.moment_id || req.body?.moment_id || '')
		let media: LeanDocument<MediaType> | null = null
		let source: 'moment_profile_image_media_id' | 'any_available_image' = 'any_available_image'

		if (momentId) {
			const moment = await Moment.findOne({
				_id: momentId,
				$or: [{ user_a: requesterId }, { user_b: requesterId }],
			}).lean()
			if (!moment) {
				next(ApiError.notFound('Moment not found', 'recreateAvatar'))
				return
			}

			const momentMediaId = resolveMomentProfileImageMediaId(moment, requesterId)
			if (momentMediaId) {
				media = await Media.findOne({ _id: momentMediaId, user_id: requesterId }).lean()
				if (media) {
					source = 'moment_profile_image_media_id'
				}
			}
		}

		if (!media) {
			media = await Media.findOne({ user_id: requesterId, type: 'image' }).sort({ train_avatar: -1, createdAt: -1 }).lean()
		}

		if (!media?._id) {
			next(ApiError.badRequest('No image available to generate avatar', 'recreateAvatar'))
			return
		}

		await User.findOneAndUpdate({ _id: requesterId }, { profile_image_media_id: media._id, avatar_generated_at: new Date() }, { new: true, runValidators: true })
		const presignedAvatarUrl = await createAvatarImage({ ...user, profile_image_media_id: media._id } as LeanDocument<UserType>)

		res.status(200).json({
			success: true,
			data: {
				profile_image_media_id: media._id,
				presignedAvatarUrl,
				source,
			},
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'recreateAvatar'))
	}
}

export const deleteAccount = async (req: Req, res: any, next: any) => {
	try {
		if (!req.requester?._id) {
			next(ApiError.badRequest('Not all required values were provided', 'deleteAccount'))
			return
		}
		const user = await User.findOne({ _id: req.requester._id }).lean().populate<{ profile_image_media_id: MediaType }>('profile_image_media_id')
		if (!user) {
			next(ApiError.notFound('User not found', 'deleteAccount'))
			return
		}
		// delete profile image
		await deleteFromS3(await getProfileImageFilename(user))
		// delete avatars file
		await deleteFromS3(await getAvatarFilenameResolved(String(user._id)))
		// Remove all S3 images in simmer-profs/{_id} bucket
		await deleteFromS3(`${String(req.requester._id)}/`)
		// Remove all dates
		const moments = await Moment.find({ $or: [{ user_a: req.requester._id }, { user_b: req.requester._id, private_to_a: false }] })
		const momentIds = moments.map(moment => String(moment._id))

		// Remove referenced momentIds from Learnings,
		// if only one momentId is referemced, remove the whole learning,
		// if multiple momentIds are referenced, remove only the deleted momentIds
		await removeMomentIdsFromLearnings(momentIds, true)
		// Remove referenced userIds from Learnings,
		// if only one userId is referenced, remove the whole learning,
		// if multiple userIds are referenced, remove only the deleted userId
		await Learning.deleteMany({ $or: [{ user_id: req.requester._id }, { reference_user_ids: [String(req.requester._id)] }] })
		await Learning.updateMany({ reference_user_ids: { $in: [String(req.requester._id)] } }, { $pull: { reference_user_ids: String(req.requester._id) } })

		while (moments.length > 0) {
			const moment = moments.pop()
			if (moment) {
				const imageKeys = Array.isArray(moment.image_urls) ? moment.image_urls.map(image => momentUtils.trimPathOnly(String(image))).filter(Boolean) : []
				for (const imageKey of imageKeys) {
					await deleteFromS3(imageKey)
				}
			}
		}
		// Remove dating meets
		await Moment.deleteMany({ $or: [{ user_a: req.requester._id }, { user_b: req.requester._id }] })
		// Remove Media files
		const media = await Media.find({ user_id: req.requester._id })
		while (media.length > 0) {
			const item = media.pop()
			if (item) {
				try {
					await deleteFromS3(`${req.requester._id}/${item.filename}`)
				} catch (error) {
					logger.error(req.requester._id, `Failed to delete media file ${item.filename} for ${req.requester._id} and media_id=${item._id}`, error)
				}
			}
		}
		// Remove Media records
		await Media.deleteMany({ user_id: req.requester._id })
		// Remove relationships
		await Relationship.deleteMany({ $or: [{ user_a: req.requester._id }, { user_b: req.requester._id }] })

		// Remove record
		await User.findOneAndDelete({ _id: req.requester._id })

		return res.status(200).send({ success: true, message: 'Account deleted successfully' })
	} catch (error) {
		next(ApiError.internal(String(error), 'deleteAccount'))
	}
}

export const getExploreUserDates = async (req: Req, res: any, next: any) => {
	try {
		const requester = req.requester
		const offset = req.query?.offset ? +req.query.offset : 0
		const limit = req.query?.limit ? +req.query.limit : 10
		const includeWorstDates = req.query?.worst === 'true'
		const test_users_only = req.query?.test_users_only ? req.query.test_users_only === 'true' : true
		const include_test_users = req.query?.include_test_users ? req.query.include_test_users === 'true' : undefined
		const use_preference_scoring = req.query?.use_preference_scoring ? req.query.use_preference_scoring === 'true' : true
		if (!requester?._id) {
			next(ApiError.badRequest('Not all required values were provided', 'getExploreUserDates'))
			return
		}
		const existingDates = await Moment.find({
			$or: [{ user_a: requester._id }, { user_b: requester._id, private_to_a: false }],
			type: 'date',
		}).lean()
		const avoidDuplicates = new Set([String(requester._id)])
		if (existingDates && existingDates.length > 0) {
			existingDates.forEach(date => {
				const partnerId = String(date.user_a._id) === String(requester._id) ? String(date.user_b?._id || '') : String(date.user_a._id)
				if (partnerId) {
					avoidDuplicates.add(partnerId)
				}
			})
		}
		// Must include filtering for any user that has been marked "Not Interested,"
		// has started a relationship [not in initial] has been presented in the last 30 days.
		const numDaysToLookBack = 30
		const haveBeenPresentedRecently = {
			stage: 'presented',
			updatedAt: {
				$gte: new Date(Date.now() - numDaysToLookBack * 24 * 60 * 60 * 1000), // last numDaysToLookBack days
			},
		}
		const areStageNotInitial = {
			stage: { $nin: ['initial'] },
		}
		const statusNotInitial = {
			status: { $nin: ['initial'] },
		}
		const relationshipsToAvoid = await Relationship.find({
			$and: [
				{ $or: [{ user_a: requester._id }, { user_b: requester._id, private_to_a: false }] },
				{ $or: [haveBeenPresentedRecently, { $and: [areStageNotInitial, statusNotInitial] }] },
			],
		}).lean()

		if (relationshipsToAvoid && relationshipsToAvoid.length > 0) {
			relationshipsToAvoid.forEach(rel => {
				const partnerId = String(rel.user_a) === String(requester._id) ? String(rel.user_b) : String(rel.user_a)
				avoidDuplicates.add(partnerId)
			})
		}

		const affinityOptions: BuildAffinityOptions = {
			requireReciprocal: true,
			hardDistanceMiles: null, // use source.location_radius if present
			excludeDealBreakerIntersect: true,
			includeTestUsers: include_test_users, // for now... later we can have a setting to include/exclude test users
			includeOnlyTestUsers: test_users_only,
			usePreferenceScoring: use_preference_scoring,
			// weights: { distanceProximity: 15 } // (optional) override
		}
		const pipeline = buildAffinityPipeline(requester, avoidDuplicates, affinityOptions)
		const userDates = await User.aggregate(pipeline).skip(offset).limit(limit)
		let worstDates: any[] = []
		if (includeWorstDates) {
			const worstPipeline = buildWorstDatePipeline(requester, {
				requireReciprocal: affinityOptions.requireReciprocal,
				includeOnlyTestUsers: affinityOptions.includeOnlyTestUsers,
				includeTestUsers: affinityOptions.includeTestUsers,
				avoidDuplicateIds: avoidDuplicates,
			})
			worstDates = await User.aggregate(worstPipeline).skip(offset).limit(limit)
			worstDates.forEach(badDate => {
				if (userDates.length < limit) {
					const alreadyIncluded = userDates.find(u => String(u._id) === String(badDate._id))
					if (!alreadyIncluded) {
						userDates.push(badDate)
					}
				}
			})
		}

		await createOrUpdateRelationshipsForPresentedDates(requester as UserType, userDates)

		const datesWithAvatar = await Promise.all(
			userDates.map(async user => ({
				_id: user._id,
				_affinity: user._score,
				first_name: (user.first_name || '').charAt(0).toUpperCase() + (user.first_name || '').slice(1).toLowerCase(),
				loc_city: user.loc_city,
				loc_state: user.loc_state,
				presignedAvatarUrl: generateS3GetPresignedUrl(await getAvatarFilenameResolved(String(user._id))),
				distanceMiles: user._distanceMiles ? Math.round(user._distanceMiles * 10) / 10 : null,
			})),
		)
		const worstWithAvatar = includeWorstDates
			? await Promise.all(
					worstDates.map(async user => ({
						_id: user._id,
						_worst_affinity: user._score,
						first_name: (user.first_name || '').charAt(0).toUpperCase() + (user.first_name || '').slice(1).toLowerCase(),
						loc_city: user.loc_city,
						loc_state: user.loc_state,
						presignedAvatarUrl: generateS3GetPresignedUrl(await getAvatarFilenameResolved(String(user._id))),
						distanceMiles: user._distanceMiles ? Math.round(user._distanceMiles * 10) / 10 : null,
					})),
				)
			: []

		return res.status(200).send({
			success: true,
			data: datesWithAvatar,
			...(includeWorstDates
				? {
						worst: worstWithAvatar,
					}
				: {}),
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'getExploreUserDates'))
	}
}
