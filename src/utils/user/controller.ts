import { type Req } from '../../utils'
import { ApiError } from '../../utils'
import { logger } from '../../utils/logger'
import { Moment } from '../../resources/moment/model'
import type { MomentType, MomentTypeEnum } from '../../resources/moment/model'
import { type UserType, User } from '../../resources/user/model'
import { type LeanDocument } from 'mongoose'
import { config } from '../../constants/config'
import { client as claudeAI } from '../claudeAI'
import { client as geminiAI } from '../geminiAI'
import { getMeetingDateImageFilename, isValidUserIdFormat } from '../../utils/user/helper'
import type { SummaryInfoType, ImageInfoType } from '../../utils/user/helper'
import { deleteFromS3 } from '../../utils/aws'
import { getShareableTokenForViewDateMeeting, mapMomentForResponse, summarizeMoment, trimPathOnly, validateAndFormatFeedback } from '../../utils/user/moment'
import { MediaType } from '../../resources/media/model'
import { updateRelationshipBasedOnDate } from '../../utils/user/relationship'
import { generateLearningsForMoment } from '../../utils/user/learning'

const getModelProviderForSummary = (_summary: any) => {
	const defaultValue = { model: config.openAI.model, provider: 'openai' }
	switch ((config.summaryAImodelProvider || '').toLowerCase()) {
		case 'claude':
			return claudeAI ? { model: config.claude.model, provider: 'claude' } : defaultValue
		case 'gemini':
			return geminiAI ? { model: 'gemini-3-flash-preview', provider: 'gemini' } : defaultValue
		default:
			return defaultValue
	}
}

type MomentParticipant = MomentType['user_a'] | MomentType['user_b'] | LeanDocument<UserType> | string | null | undefined

const isPopulatedUser = (user: MomentParticipant): user is LeanDocument<UserType> => Boolean(user && typeof user === 'object' && '_id' in user)

const getMomentParticipantId = (user: MomentParticipant): string => {
	if (!user) {
		return ''
	}
	return String(isPopulatedUser(user) ? user._id : user)
}

const loadMomentParticipant = async (user: MomentParticipant) => {
	if (isPopulatedUser(user)) {
		return user
	}

	const userId = getMomentParticipantId(user)
	if (!userId) {
		return null
	}

	return await User.findOne({ _id: userId }).lean().populate<{ profile_image_media_id: MediaType }>('profile_image_media_id')
}

const resolveMomentParticipants = async (moment: LeanDocument<MomentType> | MomentType, context: string) => {
	const [userA, userB] = await Promise.all([loadMomentParticipant(moment.user_a), loadMomentParticipant(moment.user_b)])
	if (!userA || !userB) {
		throw ApiError.notFound('Moment participant not found', context)
	}
	return { userA, userB }
}

const setNoStoreCacheHeaders = (res: any) => {
	res?.set?.('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0')
	res?.set?.('Pragma', 'no-cache')
	res?.set?.('Expires', '0')
}

export const viewMoment = async (req: Req, res: any, next: any) => {
	try {
		setNoStoreCacheHeaders(res)
		const { limit = 5, skip = 0 } = req.query
		// Support legacy aliases still used by some clients.
		const user_target = req.query?.user_target || req.query?.target_user || req.query?.target_user_id
		const user =
			user_target && isValidUserIdFormat(user_target)
				? await User.findOne({ _id: user_target }).lean().populate<{ profile_image_media_id: MediaType }>('profile_image_media_id')
				: null
		if (user_target && !user) {
			next(ApiError.notFound('Target user not found', 'viewMoment'))
			return
		}
		const moments = await Moment.find({
			...(user
				? {
						$or: [
							{ user_a: req.requester._id, user_b: user._id },
							{ user_a: user._id, user_b: req.requester._id, private_to_a: false },
						],
					}
				: {
						$or: [{ user_a: req.requester._id }, { user_b: req.requester._id, private_to_a: false }],
					}),
		})
			.sort({ createdAt: -1 })
			.skip(+skip)
			.limit(+limit)
			.populate({
				path: 'user_a',
				select: '-password',
				populate: {
					path: 'profile_image_media_id',
					select: 'filename',
				},
			})
			.populate({
				path: 'user_b',
				select: '-password',
				populate: {
					path: 'profile_image_media_id',
					select: 'filename',
				},
			})
			.lean()
		const dates = (
			await Promise.all(
				moments.map(async (moment: LeanDocument<MomentType>) => {
					try {
						const { userA, userB } = await resolveMomentParticipants(moment as LeanDocument<MomentType>, 'viewMoment')
						return await mapMomentForResponse(userA as UserType, userB as UserType, moment as MomentType)
					} catch {
						logger.warn(`viewMoment: skipping moment ${moment._id} — participant not found`)
						return null
					}
				}),
			)
		).filter(Boolean)

		res.status(200).json({
			success: true,
			data: dates,
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'viewProfile'))
	}
}

export const viewMomentById = async (req: Req, res: any, next: any) => {
	try {
		setNoStoreCacheHeaders(res)
		const { moment_id } = req.params
		const moment = await Moment.findOne({ _id: moment_id }).lean()
		if (!moment) {
			next(ApiError.notFound('Moment not found', 'viewMomentById'))
			return
		}
		if (String(moment.user_a) !== String(req.requester._id) && String(moment.user_b) !== String(req.requester._id)) {
			next(ApiError.forbidden('You do not have access to this moment', 'viewMomentById'))
			return
		}
		const { userA, userB } = await resolveMomentParticipants(moment as LeanDocument<MomentType>, 'viewMomentById')
		res.status(200).json({
			success: true,
			data: {
				...(await mapMomentForResponse(userA as UserType, userB as UserType, moment as MomentType)),
			},
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'viewMomentById'))
	}
}

export const shareMomentURL = async (req: Req, res: any, next: any) => {
	try {
		const { moment_id } = req.params
		const moment = await Moment.findOne({ _id: moment_id }).lean().populate('user_a').populate('user_b')
		if (!moment) {
			next(ApiError.notFound('Moment not found', 'shareMomentLink'))
			return
		}
		if (String(moment.user_a._id) !== String(req.requester._id) && String(moment.user_b?._id) !== String(req.requester._id)) {
			next(ApiError.forbidden('You do not have access to this dating meet', 'shareMomentLink'))
			return
		}
		const signature = getShareableTokenForViewDateMeeting(String(moment._id), String(req.requester._id))
		const url = `${config.baseUrl}/api/moment/${moment_id}/share?signature=${signature}`
		res.status(200).json({
			success: true,
			data: {
				url,
			},
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'shareMomentLink'))
	}
}

export const deleteMoment = async (req: Req, res: any, next: any) => {
	try {
		const { moment_id } = req.params
		const { hard_delete } = req.query
		const moment = await Moment.findOne({ _id: moment_id })
		if (!moment) {
			next(ApiError.notFound('Moment not found', 'deleteMoment'))
			return
		}
		// If hard delete, check if user is admin
		if (hard_delete === 'true') {
			if (req.requester.is_admin !== true) {
				next(ApiError.forbidden('You do not have access to hard delete this moment', 'deleteMoment'))
				return
			}
			await Moment.deleteOne({ _id: moment_id })
			const imageKeys = Array.isArray(moment.image_urls) ? moment.image_urls : []
			if (imageKeys.length > 0) {
				for (const imageKey of imageKeys) {
					await deleteFromS3(trimPathOnly(String(imageKey)))
				}
			} else {
				const filename = getMeetingDateImageFilename(String(moment.user_a), String(moment.user_b), moment.when)
				await deleteFromS3(filename)
			}
			res.status(200).json({
				success: true,
				message: 'Moment permanently deleted successfully',
			})
			return
		}
		if (String(moment.user_a) !== String(req.requester._id) && String(moment.user_b) !== String(req.requester._id)) {
			next(ApiError.forbidden('You do not have access to delete this moment', 'deleteMoment'))
			return
		}
		const isAlreadySoftDeletedByUserA = moment.soft_delete_user_a && String(moment.user_a) === String(req.requester._id)
		const isAlreadySoftDeletedByUserB = moment.soft_delete_user_b && String(moment.user_b) === String(req.requester._id)
		if (isAlreadySoftDeletedByUserA || isAlreadySoftDeletedByUserB) {
			next(ApiError.badRequest('You have already deleted this moment', 'deleteMoment'))
			return
		}
		if (String(moment.user_a) === String(req.requester._id)) {
			moment.soft_delete_user_a = new Date()
		}
		if (String(moment.user_b) === String(req.requester._id)) {
			moment.soft_delete_user_b = new Date()
		}
		// If both users have soft deleted, proceed to hard delete
		if (moment.soft_delete_user_a && moment.soft_delete_user_b) {
			await Moment.deleteOne({ _id: moment_id })
			const imageKeys = Array.isArray(moment.image_urls) ? moment.image_urls : []
			if (imageKeys.length > 0) {
				for (const imageKey of imageKeys) {
					await deleteFromS3(trimPathOnly(String(imageKey)))
				}
			} else {
				const filename = getMeetingDateImageFilename(String(moment.user_a), String(moment.user_b), moment.when)
				await deleteFromS3(filename)
			}
			res.status(200).json({
				success: true,
				message: 'Moment permanently deleted successfully',
			})
			return
		}
		await moment.save()
		res.status(200).json({
			success: true,
			message: 'Moment deleted successfully',
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'deleteMoment'))
	}
}

export function parseAImodelResponse(response: string): { journal: string[]; gptScore: string; toneScore: string; matchScore: string; tags: string[] } {
	try {
		logger.debug(null, 'Parsing AI response', 'responseLength=', response.length)
		const cleanedJsonString = response
			.replace(/```json\n/g, '')
			.replace(/```/g, '')
			.replace(/\n/g, '')
		logger.debug(null, 'Cleaned AI response prepared', 'cleanedLength=', cleanedJsonString.length)
		const parsed = JSON.parse(cleanedJsonString)
		return {
			journal: parsed.journal || [], // Ensure journal is an array
			gptScore: parsed.gpt_score || '0',
			toneScore: parsed.tone_score || '0',
			matchScore: parsed.match_score || '0',
			tags: parsed.tags || [],
		}
	} catch (error) {
		logger.error(null, 'Error parsing Claude response:', error)
		throw new ApiError(500, 'Failed to parse AI model response', 'parseAImodelResponse')
	}
}

export function extractScore(scoreString: string): number {
	// format scoreString as "8.5/10, extract the numeric part"
	const match = scoreString.match(/([\d.]+)(\/10|,|:)/)
	if (match) {
		return +match[1]
	}
	// format: "N points, evidence..." (compatibility_penalty)
	const pointsMatch = scoreString.match(/^([\d.]+)\s+points/i)
	if (pointsMatch) {
		return +pointsMatch[1]
	}
	const matchLevel = scoreString.match(/(strong|mixed|strained)/i)
	if (matchLevel) {
		const level = matchLevel[1].toLowerCase()
		if (level === 'strong') return 9
		if (level === 'mixed') return 5
		if (level === 'strained') return 2
	}
	return 0
}

export function extractLevel(levelString: string): string | undefined {
	// format levelString as "strong/not-observed, one single sentence evidence anchor"
	const match = levelString.toLowerCase().match(/(strong|mixed|strained|not-observed)/i)
	if (match) {
		return match[1].toLowerCase()
	}
	const matchScore = levelString.toLowerCase().match(/(\d+(\.\d+)?)\/10/i)
	if (matchScore) {
		const matchScoreValue = +matchScore[1]
		return matchScoreValue > 7 ? 'strong' : matchScoreValue > 4 ? 'mixed' : 'strained'
	}
	return undefined
}

const toFiniteNumber = (value: unknown, fallback = 0): number => {
	if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value)
		return Number.isFinite(parsed) ? parsed : fallback
	}
	return fallback
}

const resolvePrivateToA = (privateToA: unknown, universe: unknown, type: unknown): boolean => {
	if (typeof privateToA === 'boolean') {
		return privateToA
	}
	if (universe === 'simmer-world' && type === 'date') {
		return false
	}
	return true
}

export const formatFinalWhy = (finalWhy: string | { observations: string[]; insight: string } | undefined): { observations: string[]; insight: string } => {
	if (typeof finalWhy === 'string') {
		return { observations: [], insight: finalWhy }
	}
	if (finalWhy && typeof finalWhy === 'object') {
		return {
			observations: finalWhy.observations || [],
			insight: finalWhy.insight || '',
		}
	}
	return { observations: [], insight: '' }
}

const momentTypesRequiringSummary = ['chat_conversation', 'personal_moment', 'coach_moment']
const dateTypesRequiringSummary = ['text', 'chat', 'call', 'coaching', 'date']

export const storeMoment = async (
	response: { journal: string[]; gptScore: string; toneScore: string; matchScore: string; tags: string[] },
	inputTokens: number,
	outputTokens: number,
	userA: LeanDocument<UserType>,
	userB: LeanDocument<UserType>,
	meetingUrls: ImageInfoType[] = [],
	summaryInfo: SummaryInfoType | null = {},
	when?: Date,
	version?: string,
	type?: MomentTypeEnum,
): Promise<LeanDocument<MomentType>> => {
	const getStringValue = (summaryField: unknown, defaultValue: string | undefined = undefined): string | undefined => {
		const field = summaryField || extractLevel(String(summaryField || defaultValue))
		return field ? String(field).toLocaleLowerCase() : undefined
	}
	try {
		const summary = summaryInfo?.summary || {}
		const resolvedType = type || 'date'
		const resolvedUniverse = 'simmer-world'
		const avgMatchScore = toFiniteNumber(summary.avg_match_score, 0)
		const chemistrySignals = summary.chemistry_signals || ''
		const conversationalBalance = summary.conversational_balance || ''
		const conversationFlow = summary.conversation_flow || (summary as any).conversational_flow || ''
		const curiosity = summary.curiosity || ''
		const energyAlignment = summary.energy_alignment || ''
		const humorAlignment = summary.humor_alignment || ''
		const listeningResponsiveness = summary.listening_responsiveness || ''
		const repairAttempts = summary.repair_attempts || ''
		const responsiveness = summary.responsiveness || ''
		const sharedMoments = summary.shared_moments || ''
		const tensionHandling = summary.tension_handling || ''
		const { model, provider } = getModelProviderForSummary(summary) || {}
		const moment = await Moment.create({
			user_a: userA,
			user_b: userB,
			universe: resolvedUniverse,
			source: 'ai',
			type: resolvedType,
			private_to_a: resolvePrivateToA(undefined, resolvedUniverse, resolvedType),
			gpt_score: response.gptScore,
			tone_score: response.toneScore,
			key_moments: summary.key_moments || [],
			match_score: response.matchScore,
			journal_a: response.journal,
			summary_a: summary.summary || '',
			summary_b: summary.summary_b || '',
			tags: response.tags,
			version: version || 'v1',
			model,
			provider,
			when: when || new Date(),
			input_tokens: inputTokens,
			output_tokens: outputTokens,
			image_urls: (meetingUrls || [])
				.filter(url => url)
				.map(url => trimPathOnly(String(url?.dateMeetingPresignedUrl || '')))
				.filter(url => Boolean(url)),
			image_input_tokens: (meetingUrls || []).reduce((sum, url) => sum + (url?.inputTokens || 0), 0),
			image_output_tokens: (meetingUrls || []).reduce((sum, url) => sum + (url?.outputTokens || 0), 0),
			location: summary.location || '',
			items: summary.items || [],
			mood: summary.mood || '',
			title: summary.title || '',
			scene: summary.scene || '',
			moment: summary.moment || '',
			reflections: summary.reflections || [],

			chemistry_signals: chemistrySignals,
			conversational_balance: conversationalBalance,
			conversation_flow: conversationFlow,
			curiosity,
			humor_alignment: humorAlignment,
			listening_responsiveness: listeningResponsiveness,
			repair_attempts: repairAttempts,
			responsiveness,
			shared_moments: sharedMoments,
			tension_handling: tensionHandling,

			chemistry_signals_level: String(summary.chemistry_signals_level || extractLevel(String(summary.chemistry_signals_level || chemistrySignals))).toLocaleLowerCase(),
			conversational_balance_level: getStringValue(summary.conversational_balance_level, conversationalBalance),
			conversation_flow_level: getStringValue(summary.conversation_flow_level, conversationFlow),
			curiosity_level: getStringValue(summary.curiosity_level, curiosity),
			humor_alignment_level: getStringValue(summary.humor_alignment_level, humorAlignment),
			listening_responsiveness_level: getStringValue(summary.listening_responsiveness_level, listeningResponsiveness),
			repair_attempts_level: getStringValue(summary.repair_attempts_level, repairAttempts),
			responsiveness_level: getStringValue(summary.responsiveness_level, responsiveness),
			shared_moments_level: getStringValue(summary.shared_moments_level, sharedMoments),
			tension_handling_level: getStringValue(summary.tension_handling_level, tensionHandling),

			chemistry_signals_score: Number(summary.chemistry_signals_score) || extractScore(String(summary.chemistry_signals_score || chemistrySignals)),
			conversational_balance_score: Number(summary.conversational_balance_score) || extractScore(String(summary.conversational_balance_score || conversationalBalance)),
			conversation_flow_score:
				Number(summary.conversation_flow_score) || extractScore(String(summary.conversation_flow_score || (summary as any).conversational_flow_score || conversationFlow)),
			curiosity_score: Number(summary.curiosity_score) || extractScore(String(summary.curiosity_score || curiosity)),
			humor_alignment_score: Number(summary.humor_alignment_score) || extractScore(String(summary.humor_alignment_score || humorAlignment)),
			listening_responsiveness_score: Number(summary.listening_responsiveness_score) || extractScore(String(summary.listening_responsiveness_score || listeningResponsiveness)),
			repair_attempts_score: Number(summary.repair_attempts_score) || extractScore(String(summary.repair_attempts_score || repairAttempts)),
			responsiveness_score: Number(summary.responsiveness_score) || extractScore(String(summary.responsiveness_score || responsiveness)),
			shared_moments_score: Number(summary.shared_moments_score) || extractScore(String(summary.shared_moments_score || sharedMoments)),
			tension_handling_score: Number(summary.tension_handling_score) || extractScore(String(summary.tension_handling_score || tensionHandling)),

			energy_alignment: energyAlignment,
			energy_alignment_level: String(summary.energy_alignment_level || extractLevel(String(summary.energy_alignment_level || energyAlignment))).toLocaleLowerCase(),
			energy_alignment_score: Number(summary.energy_alignment_score) || extractScore(String(summary.energy_alignment_score || energyAlignment)),
			pay_attention_to: summary.pay_attention_to || [],

			compatibility_penalty_points: +extractScore(summary.compatibility_penalty || ''),
			compatibility_penalty: summary.compatibility_penalty || '',
			flags: summary.flags || [],
			tone_trend: summary.tone_trend || '',
			opening_line: summary.opening_line || '',
			ending_note: summary.ending_note || '',
			next_scenarios: summary.next_scenarios || [],
			avg_match_score: avgMatchScore,
			final_why: formatFinalWhy(summary.final_why),
		})
		if (momentTypesRequiringSummary.indexOf(moment.type) >= 0 && !moment.summary_a) {
			const { summary, title } = await summarizeMoment(moment)
			moment.summary_a = summary
			moment.title = moment.title || title
		}

		updateRelationshipBasedOnDate(moment).catch(error => {
			logger.error(String(moment.user_a || ''), `Error updating relationship based on date ${moment._id}:`, error)
		})
		await moment.save()
		return moment
	} catch (error) {
		throw new ApiError(500, `Failed to store dating meet: ${error}`, 'storeMoment')
	}
}

export const updateMoment = async (req: Req, res: any, _next: any) => {
	try {
		const { moment_id } = req.params
		const moment = await Moment.findOne({ _id: moment_id })
		if (!moment) {
			return res.status(404).json({ message: 'Moment not found' })
		}
		const {
			feedback,
			type,
			journal_a,
			journal_b,
			summary_a,
			summary_b,
			conversation,
			tags,
			tone_score,
			match_score,
			key_moments,
			location,
			items,
			mood,
			title,
			universe,
			private_to_a,
			scene,
			chemistry_signals,
			conversational_balance,
			conversation_flow,
			curiosity,
			energy_alignment,
			humor_alignment,
			listening_responsiveness,
			repair_attempts,
			responsiveness,
			shared_moments,
			tension_handling,
			compatibility_penalty,
			opening_line,
			ending_note,
			tone_trend,
			avg_match_score,
			final_why,
			source,
			when,
		} = req.body

		const nextType = type || moment.type
		const nextUniverse = universe || moment.universe || 'simmer-world'

		moment.type = nextType
		moment.journal_a = journal_a || moment.journal_a
		moment.journal_b = journal_b || moment.journal_b
		moment.summary_a = summary_a || moment.summary_a
		moment.summary_b = summary_b || moment.summary_b
		moment.conversation = conversation || moment.conversation
		moment.tags = tags || moment.tags
		moment.tone_score = tone_score || moment.tone_score
		moment.match_score = match_score || moment.match_score
		moment.key_moments = key_moments || moment.key_moments
		moment.location = location || moment.location
		moment.items = items || moment.items
		moment.mood = mood || moment.mood
		moment.title = title || moment.title
		moment.universe = nextUniverse
		moment.scene = scene || moment.scene
		moment.private_to_a = resolvePrivateToA(private_to_a, nextUniverse, nextType)
		moment.compatibility_penalty = compatibility_penalty || moment.compatibility_penalty
		moment.compatibility_penalty_points = compatibility_penalty ? +extractScore(compatibility_penalty) : moment.compatibility_penalty_points
		moment.opening_line = opening_line || moment.opening_line
		moment.ending_note = ending_note || moment.ending_note
		moment.next_scenarios = req.body.next_scenarios ?? moment.next_scenarios
		moment.tone_trend = tone_trend || moment.tone_trend
		moment.avg_match_score = avg_match_score || moment.avg_match_score
		moment.final_why = formatFinalWhy(final_why || moment.final_why)
		moment.source = source || moment.source
		moment.when = when ? new Date(when) : moment.when
		moment.pay_attention_to = moment.pay_attention_to || []

		moment.chemistry_signals = chemistry_signals || moment.chemistry_signals
		moment.chemistry_signals_level = chemistry_signals ? extractLevel(chemistry_signals) : moment.chemistry_signals_level
		moment.chemistry_signals_score = chemistry_signals ? +extractScore(chemistry_signals) : moment.chemistry_signals_score

		moment.conversational_balance = conversational_balance || moment.conversational_balance
		moment.conversational_balance_level = conversational_balance ? extractLevel(conversational_balance) : moment.conversational_balance_level
		moment.conversational_balance_score = conversational_balance ? +extractScore(conversational_balance) : moment.conversational_balance_score

		moment.conversation_flow = conversation_flow || moment.conversation_flow
		moment.conversation_flow_level = conversation_flow ? extractLevel(conversation_flow) : moment.conversation_flow_level
		moment.conversation_flow_score = conversation_flow ? +extractScore(conversation_flow) : moment.conversation_flow_score

		moment.curiosity = curiosity || moment.curiosity
		moment.curiosity_level = curiosity ? extractLevel(curiosity) : moment.curiosity_level
		moment.curiosity_score = curiosity ? +extractScore(curiosity) : moment.curiosity_score

		moment.energy_alignment = energy_alignment || moment.energy_alignment
		moment.energy_alignment_level = energy_alignment ? extractLevel(energy_alignment) : moment.energy_alignment_level
		moment.energy_alignment_score = energy_alignment ? +extractScore(energy_alignment) : moment.energy_alignment_score

		moment.humor_alignment = humor_alignment || moment.humor_alignment
		moment.humor_alignment_level = humor_alignment ? extractLevel(humor_alignment) : moment.humor_alignment_level
		moment.humor_alignment_score = humor_alignment ? +extractScore(humor_alignment) : moment.humor_alignment_score

		moment.listening_responsiveness = listening_responsiveness || moment.listening_responsiveness
		moment.listening_responsiveness_level = listening_responsiveness ? extractLevel(listening_responsiveness) : moment.listening_responsiveness_level
		moment.listening_responsiveness_score = listening_responsiveness ? +extractScore(listening_responsiveness) : moment.listening_responsiveness_score

		moment.repair_attempts = repair_attempts || moment.repair_attempts
		moment.repair_attempts_level = repair_attempts ? extractLevel(repair_attempts) : moment.repair_attempts_level
		moment.repair_attempts_score = repair_attempts ? +extractScore(repair_attempts) : moment.repair_attempts_score

		moment.responsiveness = responsiveness || moment.responsiveness
		moment.responsiveness_level = responsiveness ? extractLevel(responsiveness) : moment.responsiveness_level
		moment.responsiveness_score = responsiveness ? +extractScore(responsiveness) : moment.responsiveness_score

		moment.shared_moments = shared_moments || moment.shared_moments
		moment.shared_moments_level = shared_moments ? extractLevel(shared_moments) : moment.shared_moments_level
		moment.shared_moments_score = shared_moments ? +extractScore(shared_moments) : moment.shared_moments_score

		moment.tension_handling = tension_handling || moment.tension_handling
		moment.tension_handling_level = tension_handling ? extractLevel(tension_handling) : moment.tension_handling_level
		moment.tension_handling_score = tension_handling ? +extractScore(tension_handling) : moment.tension_handling_score

		let learning: any = null
		if (feedback) {
			const validatedFeedback = await validateAndFormatFeedback(moment, feedback)
			if (!validatedFeedback) {
				return res.status(400).json({ message: 'Invalid feedback format' })
			}
			moment.feedback = validatedFeedback
		}
		if (momentTypesRequiringSummary.indexOf(moment.type) >= 0 && !moment.summary_a) {
			const { summary, title } = await summarizeMoment(moment)
			moment.summary_a = summary
			moment.title = moment.title || title
		}
		await moment.save()
		if (moment.feedback?.length) {
			try {
				learning = await generateLearningsForMoment(moment)
			} catch (error) {
				logger.warn({ error, moment_id: moment_id }, 'Failed to generate learnings for updated moment feedback')
			}
		}
		// Populate user_a and user_b to ensure consistent response shape
		const populatedMoment = await Moment.findOne({ _id: moment._id })
			.populate({
				path: 'user_a',
				select: '-password',
				populate: {
					path: 'profile_image_media_id',
					select: 'filename',
				},
			})
			.populate({
				path: 'user_b',
				select: '-password',
				populate: {
					path: 'profile_image_media_id',
					select: 'filename',
				},
			})
			.lean()

		const mappedMoment = await mapMomentForResponse(populatedMoment?.user_a as UserType, populatedMoment?.user_b as UserType, populatedMoment as MomentType)

		return res.status(200).json({
			success: true,
			data: {
				moment: mappedMoment,
				learning,
			},
		})
	} catch (error) {
		return res.status(500).json({ message: 'Failed to update moment', error })
	}
}

export const createMoment = async (req: Req, res: any, next: any) => {
	try {
		const {
			user_b,
			feedback,
			type = 'date',
			journal_a,
			journal_b,
			summary_a,
			summary_b,
			conversation,
			tags,
			tone_score,
			match_score,
			key_moments,
			location,
			items,
			mood,
			title,
			universe,
			private_to_a,
			scene,
			chemistry_signals,
			conversational_balance,
			conversation_flow,
			curiosity,
			energy_alignment,
			humor_alignment,
			listening_responsiveness,
			repair_attempts,
			responsiveness,
			shared_moments,
			tension_handling,
			compatibility_penalty,
			opening_line,
			ending_note,
			tone_trend,
			avg_match_score,
			final_why,
			source,
			when,
		} = req.body
		if (!user_b && momentTypesRequiringSummary.indexOf(type) < 0) {
			next(ApiError.badRequest('user_b is required to create a moment', 'createMoment'))
			return
		}
		var userB = null
		if (user_b) {
			userB = await User.findOne({ _id: user_b })
			if (!userB) {
				next(ApiError.notFound('Target user not found', 'createMoment'))
				return
			}
		}
		const formattedFeedback = feedback ? await validateAndFormatFeedback(null, feedback) : undefined
		if (feedback && !formattedFeedback) {
			next(ApiError.badRequest('Invalid feedback format', 'createMoment'))
			return
		}
		const resolvedType = type || 'date'
		const resolvedUniverse = universe || 'simmer-world'
		const moment = new Moment({
			user_a: req.requester._id,
			user_b,
			type: resolvedType,
			private_to_a: resolvePrivateToA(private_to_a, resolvedUniverse, resolvedType),
			journal_a,
			journal_b,
			summary_a,
			summary_b,
			conversation,
			tags,
			tone_score,
			match_score,
			key_moments,
			location,
			items,
			mood,
			title,
			universe: resolvedUniverse,
			scene,

			// behavioral variables — plain
			chemistry_signals,
			conversational_balance,
			conversation_flow,
			curiosity,
			energy_alignment,
			humor_alignment,
			listening_responsiveness,
			repair_attempts,
			responsiveness,
			shared_moments,
			tension_handling,

			// behavioral variables — score
			chemistry_signals_score: chemistry_signals ? +extractScore(chemistry_signals) : undefined,
			conversational_balance_score: conversational_balance ? +extractScore(conversational_balance) : undefined,
			conversation_flow_score: conversation_flow ? +extractScore(conversation_flow) : undefined,
			curiosity_score: curiosity ? +extractScore(curiosity) : undefined,
			energy_alignment_score: energy_alignment ? +extractScore(energy_alignment) : undefined,
			humor_alignment_score: humor_alignment ? +extractScore(humor_alignment) : undefined,
			listening_responsiveness_score: listening_responsiveness ? +extractScore(listening_responsiveness) : undefined,
			repair_attempts_score: repair_attempts ? +extractScore(repair_attempts) : undefined,
			responsiveness_score: responsiveness ? +extractScore(responsiveness) : undefined,
			shared_moments_score: shared_moments ? +extractScore(shared_moments) : undefined,
			tension_handling_score: tension_handling ? +extractScore(tension_handling) : undefined,

			// behavioral variables — level
			chemistry_signals_level: chemistry_signals ? extractLevel(chemistry_signals) : undefined,
			conversational_balance_level: conversational_balance ? extractLevel(conversational_balance) : undefined,
			conversation_flow_level: conversation_flow ? extractLevel(conversation_flow) : undefined,
			curiosity_level: curiosity ? extractLevel(curiosity) : undefined,
			energy_alignment_level: energy_alignment ? extractLevel(energy_alignment) : undefined,
			humor_alignment_level: humor_alignment ? extractLevel(humor_alignment) : undefined,
			listening_responsiveness_level: listening_responsiveness ? extractLevel(listening_responsiveness) : undefined,
			repair_attempts_level: repair_attempts ? extractLevel(repair_attempts) : undefined,
			responsiveness_level: responsiveness ? extractLevel(responsiveness) : undefined,
			shared_moments_level: shared_moments ? extractLevel(shared_moments) : undefined,
			tension_handling_level: tension_handling ? extractLevel(tension_handling) : undefined,

			// other
			compatibility_penalty,
			compatibility_penalty_points: compatibility_penalty ? +extractScore(compatibility_penalty) : undefined,
			pay_attention_to: [],
			opening_line,
			ending_note,
			next_scenarios: req.body.next_scenarios,
			tone_trend,
			avg_match_score,
			final_why: formatFinalWhy(final_why),
			source,
			feedback: formattedFeedback,
			when: when ? new Date(when) : new Date(),
		})
		// Provide a summary
		// Use Ember's voice to summarize the moment,
		// even if the moment is not created by Ember, to maintain a consistent and relatable tone in the summaries that users receive. This way, users can have a familiar and engaging narrative style in their moment summaries, which can enhance their connection to the insights and reflections provided. Additionally, using Ember's voice can help to humanize the AI-generated content and make it more enjoyable for users to read and reflect upon.
		if (dateTypesRequiringSummary.indexOf(moment.type) >= 0 && !moment.summary_a) {
			const { summary, title } = await summarizeMoment(moment)
			moment.summary_a = summary
			moment.title = title
		}
		await moment.save()
		var learning: any = null
		// Learning from feedback if exists
		if (moment.feedback?.length) {
			learning = await generateLearningsForMoment(moment)
		}

		// Learning relationship - Missing only when user_a and user_b exist, but we can also consider generating relationship insights even for personal moments or coach moments where user_b might not exist, as long as there is meaningful feedback that can be attributed to interactions or preferences related to the requester (user_a). This way we can still derive insights about the user's preferences, avoidances, and other learnings even from moments that are not directly tied to another user.
		// Learning profile -- Missing

		// Populate user_a and user_b to ensure consistent response shape
		const populatedMoment = await Moment.findOne({ _id: moment._id })
			.populate({
				path: 'user_a',
				select: '-password',
				populate: {
					path: 'profile_image_media_id',
					select: 'filename',
				},
			})
			.populate({
				path: 'user_b',
				select: '-password',
				populate: {
					path: 'profile_image_media_id',
					select: 'filename',
				},
			})
			.lean()
		const mappedMoment = await mapMomentForResponse(populatedMoment?.user_a as UserType, populatedMoment?.user_b as UserType, populatedMoment as MomentType)

		return res.status(201).json({
			success: true,
			message: 'Moment created successfully',
			data: {
				moment: mappedMoment,
				learning,
			},
		})
	} catch (error) {
		logger.error(req.requester?._id, 'Error creating moment', {
			error:
				error instanceof Error
					? {
							name: error.name,
							message: error.message,
							stack: error.stack,
							cause: (error as any).cause,
						}
					: error,
		})
		next(ApiError.internal(String(error), 'createMoment'))
	}
}
