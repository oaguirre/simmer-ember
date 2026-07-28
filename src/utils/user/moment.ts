import jwt from 'jsonwebtoken'
import process from 'node:process'
import { config } from '../../constants/config'
import { Anthropic } from '@anthropic-ai/sdk/client.js'
import { UserType } from '../../resources/user/model'
import { Moment, MomentType } from '../../resources/moment/model'
import { User } from '../../resources/user/model'
import ApiError from '../apiError'
import { checkS3IfFileExists, generateS3GetPresignedUrl } from '../aws'
import { client as claudeAI } from '../claudeAI'
import { client as openAI } from '../openAI'
import { Req } from '../types'
import { ImageInfoType, SummaryInfoType, getAvatarFilenameResolved, getMeetingDateImagePresignedUrl, getProfileImageFilename, isValidUserIdFormat } from './helper'
import { LeanDocument } from 'mongoose'
import { MediaType } from '../../resources/media/model'
import Learning, { LearningType } from '../../resources/learning/model'
import { summarizeCoachMomentPrompts, summarizeUserChatMomentPrompts } from '../../resources/matches/summarizePrompts'
import { logger } from '../logger'
import { StartDBInstanceAutomatedBackupsReplicationMessage } from 'aws-sdk/clients/rds'
import { isValidEmail } from '../validation'

const S3_GET_URL_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60

export interface ViewDateTokenPayload {
	userId: string
	momentId: string
	type: 'dating_meet'
	iat?: number
	exp?: number
}

export const signForViewDateToken = (payload: ViewDateTokenPayload, expiresIn: string | number): string => {
	if (!config.secrets.jwt) {
		throw new Error('JWT secret is not configured')
	}
	return jwt.sign(payload, config.secrets.jwt, { expiresIn } as jwt.SignOptions)
}

export const verifyViewDateToken = async (token: string): Promise<ViewDateTokenPayload> =>
	await new Promise((resolve, reject) => {
		if (!config.secrets.jwt) {
			reject(new Error('JWT secret is not configured'))
			return
		}
		jwt.verify(token, config.secrets.jwt, (err, payload) => {
			if (err) {
				reject(err)
				return
			}
			resolve(payload as ViewDateTokenPayload)
		})
	})

export const getShareableTokenForViewDateMeeting = (momentId: string, requesterId: string, expiresIn: string = '365d'): string => {
	const payload: ViewDateTokenPayload = {
		userId: requesterId,
		momentId,
		type: 'dating_meet',
	}
	return signForViewDateToken(payload, expiresIn) // URL valid for 1 year
}

export const validateDateRequest = (req: Req, user_target: string) => {
	if (!user_target) {
		throw ApiError.badRequest('Missing user_target parameter', 'createMomentWithUser->validateDateRequest')
	}
	if (!isValidUserIdFormat(user_target)) {
		throw ApiError.badRequest('Wrong user_target ID format', 'createMomentWithUser->validateDateRequest')
	}
	if (String(req.requester?._id) === String(user_target)) {
		throw ApiError.badRequest('Cannot create a date with yourself', 'createMomentWithUser')
	}
	const answers = (req.requester?.core_answers || []).filter(ans => ans?.trim())
	if (answers.length < 5) {
		throw ApiError.badRequest('Not all required values were provided by requester', 'createMomentWithUser->validateDateRequest')
	}
}

export const validateDateTargetUser = async (user_target: string, email: string | undefined) => {
	if (!isValidUserIdFormat(user_target) && !email) {
		throw ApiError.badRequest('Bad format for user_target ID', 'createMomentWithUser->validateDateTargetUser')
	}
	if (!isValidEmail(email) && !user_target) {
		throw ApiError.badRequest('Bad format for email', 'createMomentWithUser->validateDateTargetUser')
	}
	const query = user_target
		? User.findOne({ _id: user_target })
		: User.findOne({ email: email?.toLowerCase() })
	const user = (await (typeof (query as any)?.lean === 'function'
		? (query as ReturnType<typeof User.findOne>).lean().populate<{ profile_image_media_id: MediaType }>('profile_image_media_id')
		: query)) as (UserType & { profile_image_media_id: MediaType }) | null
	if (!user) {
		throw ApiError.notFound('Target user not found', 'createMomentWithUser->validateDateTargetUser')
	}
	const targetAnswers = (user?.core_answers || []).filter(ans => ans?.trim())
	if (targetAnswers.length < 5) {
		throw ApiError.badRequest('Not all required values were provided by target user', 'createMomentWithUser->validateDateTargetUser')
	}
	return user
}

export const processAIDateResponse = async (summaryToUse: any, matchingPromptToUse: any, requester: UserType, user: UserType) => {
	if (!summaryToUse.requiresTranscript) return ''
	const usersInformation = matchingPromptToUse.getUsersInformation(requester, user)
	const userMessage = matchingPromptToUse.prompt.concat(usersInformation)

	try {
		const claudeResponse = await claudeAI?.messages.create({
			model: 'claude-sonnet-4-6',
			max_tokens: config.claude.maxTokens,
			messages: [{ role: 'user', content: userMessage }],
		})
		return {
			reply: claudeResponse?.content[0].type === 'text' ? claudeResponse.content[0].text : '',
			claudeResponse,
		}
	} catch (error) {
		const isAnAPIError = error instanceof Anthropic.APIError || (error as any)?.constructor?.name === 'APIError'
		if (isAnAPIError && [429, 529].indexOf((error as any).status) !== -1) {
			const openAIResponse = await openAI?.responses.create({
				model: 'gpt-4.1',
				input: [{ role: 'user', content: [{ type: 'input_text', text: userMessage }] }],
			})
			const content = openAIResponse?.output.filter((output: any) => output.type === 'message').map((output: any) => (output as any).content as any[])
			const itemText = content?.[0].filter((item: any) => item?.type === 'output_text').map((item: any) => item.text)
			return {
				reply: itemText?.[0] || '',
				openAIResponse,
			}
		}
		throw ApiError.internal('Error communicating with Claude API', 'createMomentWithUser->processAIDateResponse')
	}
}

export const mapMomentForResponse = async (userA: UserType, userB: UserType, moment: MomentType | LeanDocument<MomentType> | null) => {
	const resolveMomentImageKey = async (rawUrl: string): Promise<string | null> => {
		const key = trimPathOnly(rawUrl)
		if (!key) {
			return null
		}

		const webpCandidate = key.replace(/\.(jpg|jpeg|png|gif|tiff|tif|heic|heif)$/i, '.webp')
		const candidates = webpCandidate !== key ? [webpCandidate, key] : [key]

		for (const candidate of candidates) {
			if (await checkS3IfFileExists(config.s3.bucketName, candidate)) {
				return candidate
			}
		}

		return null
	}

	const imageKeys = (moment?.image_urls || []).map(url => String(url || ''))
	const resolvedImageKeys = (
		await Promise.all(
			imageKeys.map(async key => {
				try {
					return await resolveMomentImageKey(key)
				} catch {
					return null
				}
			}),
		)
	).filter((key): key is string => Boolean(key))

	const imageUrls = resolvedImageKeys.map(key => generateS3GetPresignedUrl(key, S3_GET_URL_EXPIRES_IN_SECONDS))
	const learnings = await Learning.find({
		user_id: userA._id,
		moment_ids: { $in: [moment?._id] },
	}).lean()

	if (imageUrls.length === 0) {
		const meetingPresignedUrl = await getMeetingDateImagePresignedUrl(String(userA._id), String(userB._id), moment?.when)
		if (meetingPresignedUrl) {
			imageUrls.push(meetingPresignedUrl)
		}
	}
	return {
		_id: moment?._id,
		user_a: {
			_id: moment?.user_a?._id,
			first_name: ((moment?.user_a as any) || {}).first_name,
			avatar_url: generateS3GetPresignedUrl(await getAvatarFilenameResolved(String(userA._id)), S3_GET_URL_EXPIRES_IN_SECONDS),
			image_url: generateS3GetPresignedUrl(await getProfileImageFilename(userA), S3_GET_URL_EXPIRES_IN_SECONDS),
		},
		user_b: {
			_id: moment?.user_b?._id,
			first_name: ((moment?.user_b as any) || {}).first_name,
			avatar_url: generateS3GetPresignedUrl(await getAvatarFilenameResolved(String(userB._id)), S3_GET_URL_EXPIRES_IN_SECONDS),
			image_url: generateS3GetPresignedUrl(await getProfileImageFilename(userB), S3_GET_URL_EXPIRES_IN_SECONDS),
		},
		type: moment?.type,
		universe: moment?.universe,
		model: moment?.model,
		provider: moment?.provider,
		source: moment?.source,
		private_to_a: moment?.private_to_a || true,
		when: moment?.when,
		summary_a: moment?.summary_a,
		summary_b: moment?.summary_b,
		journal_a: moment?.journal_a,
		journal_b: moment?.journal_b,
		tags: moment?.tags,
		items: moment?.items,
		tone_score: moment?.tone_score,
		match_score: moment?.match_score,

		chemistry_signals: moment?.chemistry_signals,
		conversational_balance: moment?.conversational_balance,
		conversation_flow: moment?.conversation_flow,
		curiosity: moment?.curiosity,
		energy_alignment: moment?.energy_alignment,
		humor_alignment: moment?.humor_alignment,
		listening_responsiveness: moment?.listening_responsiveness,
		repair_attempts: moment?.repair_attempts,
		responsiveness: moment?.responsiveness,
		shared_moments: moment?.shared_moments,
		tension_handling: moment?.tension_handling,

		chemistry_signals_level: moment?.chemistry_signals_level,
		conversational_balance_level: moment?.conversational_balance_level,
		conversation_flow_level: moment?.conversation_flow_level,
		curiosity_level: moment?.curiosity_level,
		energy_alignment_level: moment?.energy_alignment_level,
		humor_alignment_level: moment?.humor_alignment_level,
		listening_responsiveness_level: moment?.listening_responsiveness_level,
		repair_attempts_level: moment?.repair_attempts_level,
		responsiveness_level: moment?.responsiveness_level,
		shared_moments_level: moment?.shared_moments_level,
		tension_handling_level: moment?.tension_handling_level,

		chemistry_signals_score: moment?.chemistry_signals_score,
		conversational_balance_score: moment?.conversational_balance_score,
		conversation_flow_score: moment?.conversation_flow_score,
		curiosity_score: moment?.curiosity_score,
		humor_alignment_score: moment?.humor_alignment_score,
		listening_responsiveness_score: moment?.listening_responsiveness_score,
		repair_attempts_score: moment?.repair_attempts_score,
		responsiveness_score: moment?.responsiveness_score,
		shared_moments_score: moment?.shared_moments_score,
		tension_handling_score: moment?.tension_handling_score,
		energy_alignment_score: moment?.energy_alignment_score,

		moment: moment?.moment,
		opening_line: moment?.opening_line,
		ending_note: moment?.ending_note,
		next_scenarios: moment?.next_scenarios?.map(scenario => ({ location: scenario.location, scenario_type: scenario.scenario_type, description: scenario.description })) || [],

		pay_attention_to: moment?.pay_attention_to,
		compatibility_penalty: moment?.compatibility_penalty,
		compatibility_penalty_points: moment?.compatibility_penalty_points,
		version: moment?.version,
		location: moment?.location,
		title: moment?.title,
		scene: moment?.scene,
		mood: moment?.mood,
		final_why: moment?.final_why,
		input_tokens: moment?.input_tokens,
		output_tokens: moment?.output_tokens,
		feedback:
			moment?.feedback?.map(item => ({
				_id: (item as any)?._id,
				source: item?.source,
				target: item?.target,
				validation_score: item?.validation_score,
				question: item?.question,
				answer: item?.answer,
				comment: item?.comment,
				title: item?.title,
				summary: item?.summary,
				when: item?.when,
			})) || [],
		image_urls: imageUrls,
		learnings: learnings.map(learning => ({
			_id: learning._id,
			summary: learning.summary,
			facts: learning.facts,
			preferences: learning.preferences,
			avoidances: learning.avoidances,
			insights: learning.insights,
			hypotheses: learning.hypotheses,
			reference_user_ids: learning.reference_user_ids,
			moment_ids: learning.moment_ids,
			createdAt: learning.createdAt,
			updatedAt: learning.updatedAt,
		})),
	} as unknown as
		| (MomentType & {
				user_a: any
				user_b: any
				learnings?: LearningType[]
		  })
		| null
}

export const buildDateResponse = async (
	user: UserType,
	reply: string,
	moment: LeanDocument<MomentType> | null,
	meetingUrls: ImageInfoType[],
	summary: SummaryInfoType,
	requester: UserType,
) => ({
	success: true,
	message: 'Date created successfully with user',
	// data field added
	// Info in dating meet
	// user: { _id: user._id, first_name: user.first_name },
	// reply,
	// moved...
	// meetingUrls to image_urls,
	// summary to summary_a
	data: moment ? await mapMomentForResponse(requester, user, moment) : {},
})

export const validateImageRequest = (req: Req, user_target: string, moment_id: string, dating_meet_id: string) => {
	if (String(req.requester?._id) === String(user_target)) {
		throw ApiError.badRequest('You cannot create a dating image with yourself', 'createMomentImageOnly')
	}
	if (!user_target && !(moment_id || dating_meet_id)) {
		throw ApiError.badRequest('No target/moment_id provided', 'createMomentImageOnly')
	}
}

export const findMoment = async (moment_id: string, user_target: string, requesterId: string) => {
	if (moment_id) {
		const existingMeet = await Moment.findOne({ _id: moment_id, user_a: requesterId }).lean()
		if (!existingMeet) {
			throw ApiError.notFound(`Moment not found with moment_id ${moment_id}`, 'createMomentImageOnly')
		}
		return { existingMeet, user_target: String(existingMeet.user_b) }
	}
	const mostRecentMoment = await Moment.findOne(
		{
			$or: [
				{ user_a: requesterId, user_b: user_target },
				{ user_a: user_target, user_b: requesterId, private_to_a: false },
			],
		},
		{ sort: { createdAt: -1 } },
	)
	if (!mostRecentMoment) {
		throw ApiError.badRequest(`No moment found to add image with user ${user_target}`, 'createMomentImageOnly')
	}
	return { existingMeet: mostRecentMoment, user_target }
}

export const trimPathOnly = (path: string) => {
	if (!path) {
		return path
	}

	if (path.startsWith('https://') || path.startsWith('http://')) {
		try {
			const parsed = new URL(path)
			const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
			return key
		} catch {
			return path.split('?')[0]
		}
	}

	return path.split('?')[0]
}

export const updateMeetWithImage = async (existingMeet: MomentType | LeanDocument<MomentType>, imageFilename: string) => {
	if (!existingMeet.image_urls) existingMeet.image_urls = []

	const imageAlreadyExists = existingMeet.image_urls.indexOf(imageFilename) !== -1
	if (!imageAlreadyExists) {
		existingMeet.image_urls.push(imageFilename)
		await Moment.updateOne(
			{ _id: existingMeet._id },
			{
				image_urls: [...new Set(existingMeet.image_urls.map(image => trimPathOnly(image)))],
			},
		)
	}
	return imageAlreadyExists
}

export const buildImageResponse = async (
	meetingImage: ImageInfoType,
	existingMeet: MomentType | LeanDocument<MomentType>,
	imageAlreadyExists: boolean,
	userA: LeanDocument<UserType>,
	userB: LeanDocument<UserType>,
) => ({
	success: true,
	message: `Dating meet image ${imageAlreadyExists ? 'updated' : 'created'} successfully`,
	data: {
		meeting_image: meetingImage,
		dating_meet: await mapMomentForResponse(userA as UserType, userB as UserType, existingMeet),
		moment: await mapMomentForResponse(userA as UserType, userB as UserType, existingMeet),
	},
})

// At the top of your file or in a separate module
let pipelineInstance: any = null
const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (modulePath: string) => Promise<any>
const loadTransformers = async () => {
	if (process.env.NODE_ENV === 'test') {
		return await import('@xenova/transformers')
	}
	return await dynamicImport('@xenova/transformers')
}

async function getSummarizationPipeline() {
	if (!pipelineInstance) {
		const { pipeline } = await loadTransformers()
		pipelineInstance = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6')
	}
	return pipelineInstance
}

export const validateAndFormatFeedback = async (moment: MomentType | null, feedback: any) => {
	const normalizeText = (text?: string) => (text || '').replace(/\s+/g, '').trim().toLowerCase()
	const formattedFeedback: any = moment?.feedback || []
	const arrayFeedBack = Array.isArray(feedback) ? feedback : [feedback]
	for (const item of arrayFeedBack) {
		const feedbackId = item?._id ? String(item._id) : ''
		const isQuestion = typeof item === 'object' && !!item?.question && !!item?.answer
		const isComment = typeof item === 'object' && !!item?.comment
		if (!isQuestion && !isComment) {
			throw ApiError.badRequest('Invalid feedback format', 'addMomentFeedback')
		}
		const feedbackSource = item.source || 'user_a'
		const defaultTarget = feedbackSource === 'user_a' && moment?.user_b && moment?.universe == 'reality' ? 'relationship' : 'ember'
		const existingFeedback = formattedFeedback.find((f: any) => {
			if (feedbackId && String(f?._id || '') === feedbackId) return true
			if (f.source !== feedbackSource) return false
			const sameQuestion = item.question && normalizeText(f.question) === normalizeText(item.question)
			const sameComment = item.comment && normalizeText(f.comment) === normalizeText(item.comment)
			return sameQuestion || sameComment
		})
		if (existingFeedback) {
			existingFeedback.source = feedbackSource
			existingFeedback.target = item.target || existingFeedback.target || defaultTarget
			existingFeedback.validation_score = Number(item.validation_score || existingFeedback.validation_score || '10')
			existingFeedback.question = isQuestion ? item.question : existingFeedback.question
			existingFeedback.answer = isQuestion ? item.answer : existingFeedback.answer
			existingFeedback.comment = isComment ? item.comment : existingFeedback.comment
			existingFeedback.when = item?.when ? new Date(item.when) : existingFeedback.when || new Date()
			if (!existingFeedback.title) {
				try {
					const pipe = await getSummarizationPipeline()
					existingFeedback.title = isQuestion
						? await pipe(`${item.question}\nAnswer: ${item.answer}`, { max_length: 50 }).then((res: any) => res[0].summary_text)
						: await pipe(item.comment, { max_length: 50 }).then((res: any) => res[0].summary_text)
				} catch (error) {
					logger.error('Error generating title:', error)
					existingFeedback.title = isQuestion
						? `Question: "${item.question}" Answer: "${item.answer}"`
						: `Comment: "${item.comment.length > 100 ? item.comment.slice(0, 100) + '...' : item.comment}"`
				}
			}
			if (!existingFeedback.summary) {
				try {
					const pipe = await getSummarizationPipeline()
					existingFeedback.summary = isQuestion
						? await pipe(`${item.question}\nAnswer: ${item.answer}`, { max_length: 100 }).then((res: any) => res[0].summary_text)
						: await pipe(item.comment, { max_length: 100 }).then((res: any) => res[0].summary_text)
				} catch (error) {
					logger.error('Error generating summary:', error)
					existingFeedback.summary = isQuestion ? `Feedback on question: "${item.question}" with answer "${item.answer}"` : `Comment: "${item.comment}"`
				}
			}
			continue
		}
		if (!item.title) {
			try {
				const pipe = await getSummarizationPipeline()
				item.title = isQuestion
					? await pipe(`${item.question}\nAnswer: ${item.answer}`, { max_length: 50 }).then((res: any) => res[0].summary_text)
					: await pipe(item.comment, { max_length: 50 }).then((res: any) => res[0].summary_text)
			} catch (error) {
				logger.error('Error generating title:', error)
				item.title = isQuestion
					? `Question: "${item.question}" Answer: "${item.answer}"`
					: `Comment: "${item.comment.length > 100 ? item.comment.slice(0, 100) + '...' : item.comment}"`
			}
		}
		if (!item.summary) {
			try {
				const pipe = await getSummarizationPipeline()
				item.summary = isQuestion
					? await pipe(`${item.question}\nAnswer: ${item.answer}`, { max_length: 512 }).then((res: any) => res[0].summary_text)
					: await pipe(item.comment, { max_length: 512 }).then((res: any) => res[0].summary_text)
			} catch (error) {
				logger.error('Error generating summary:', error)
				item.summary = isQuestion ? `Feedback on question: "${item.question}" with answer "${item.answer}"` : `Comment: "${item.comment}"`
			}
		}
		formattedFeedback.push({
			_id: item?._id,
			source: feedbackSource,
			target: item.target || defaultTarget,
			title: item.title || '',
			summary: item.summary || '',
			validation_score: Number(item.validation_score || '10'),
			question: isQuestion ? item.question : undefined,
			answer: isQuestion ? item.answer : undefined,
			comment: isComment ? item.comment : undefined,
			when: item?.when ? new Date(item.when) : new Date(),
		})
	}
	return formattedFeedback
}

export const summarizeMoment = async (moment: MomentType | LeanDocument<MomentType>): Promise<{ summary: string; title: string }> => {
	var summaryPrompt = ''
	switch (moment.type) {
		case 'date':
		case 'text':
		case 'call':
			summaryPrompt = moment.universe === 'reality' ? summarizeUserChatMomentPrompts.v1.prompt : ''
			break
		case 'chat':
			summaryPrompt = summarizeUserChatMomentPrompts.v1.prompt
			break
		case 'coaching':
			summaryPrompt = summarizeCoachMomentPrompts.v1.prompt
			break
		default:
			summaryPrompt = moment.universe === 'reality' ? summarizeUserChatMomentPrompts.v1.prompt : ''
	}
	const { conversation, feedback, moment: momentField, journal_a } = moment
	// Consider for summarization a concatenation of
	// - the journal if it exists
	// - the conversation if it exists and the journal doesn't (to avoid redundancy in case both exist)
	// - the moment description if neither journal nor conversation exist (to have at least some context for summarization, even if it's not ideal)
	// - feedback could also be considered for summarization, but it can create a circular dependency as feedback is what triggers summarization in some cases, so it would need to be handled carefully to avoid infinite loops
	// - for comments, we should only consider the comment text for summarization to avoid redundancy and ensure the summary is focused on the comment content rather than the entire moment context, which may not be relevant for comment feedback
	// - also consider the feedback validation_score
	const allFeedbackText = `${
		feedback
			?.filter(f => f.comment)
			.map(f => `Feedback with validation score ${f.validation_score} by ${f.source || 'unknown'}: ${f.comment}`)
			.join('\n') || ''
	}`
	const primaryContent = journal_a?.length ? journal_a.join('\n---\n') : conversation || momentField || ''
	const userContent = [primaryContent, allFeedbackText]
		.map(segment => segment?.trim())
		.filter(Boolean)
		.join('\n---\n')
	if (!summaryPrompt) {
		logger.info('No summary prompt found for moment type:', moment.type, 'Universe:', moment.universe)
		return { summary: moment.summary_a || '', title: moment.title || '' }
	}
	try {
		logger.info('Summarizing moment with Claude AI:', { summaryPrompt, userContent })
		const claudeResponse = await claudeAI?.messages.create({
			model: 'claude-sonnet-4-6',
			max_tokens: config.claude.maxTokens,
			messages: [
				{ role: 'user', content: summaryPrompt },
				{ role: 'user', content: userContent },
			],
		})
		logger.info('Claude summarization response:', claudeResponse)
		const responseJson = claudeResponse?.content[0].type === 'text' ? claudeResponse.content[0].text : ''
		const parsedResponse = JSON.parse(responseJson.replace('```json\n', '').replace('```', '') || '{}')
		logger.info('Parsed summarization response:', parsedResponse)
		return { summary: parsedResponse.summary || '', title: parsedResponse.title || '' }
	} catch (error) {
		logger.info('Error during summarization with Claude AI:', error, JSON.stringify(error))
		const isAnAPIError = error instanceof Anthropic.APIError || (error as any)?.constructor?.name === 'APIError'
		if (isAnAPIError && [429, 529].includes((error as any).status)) {
			const openAIResponse = await openAI?.responses.create({
				model: 'gpt-4.1',
				input: [
					{
						role: 'user',
						content: [
							{ type: 'input_text', text: summaryPrompt },
							{ type: 'input_text', text: userContent },
						],
					},
				],
			})
			logger.info('OpenAI summarization response:', openAIResponse)
			const content = openAIResponse?.output.filter((output: any) => output.type === 'message').map((output: any) => (output as any).content as any[])
			const jsonOutput = content?.[0]
				.filter((item: any) => item?.type === 'output_text')
				.map((item: any) => item.text)
				.join('')
			try {
				const parsedOutput = JSON.parse(jsonOutput || '{}')
				logger.info('Parsed summarization output:', parsedOutput)
				return {
					summary: parsedOutput.summary || '',
					title: parsedOutput.title || '',
				}
			} catch (error) {
				logger.error('Error parsing summarization output:', error, 'Raw output:', jsonOutput)
			}
		}
		return {
			summary: '',
			title: '',
		}
	}
}
