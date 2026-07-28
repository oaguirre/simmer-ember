import dotenv, { populate } from 'dotenv'
import process from 'node:process'
dotenv.config({ path: `.${process.env.NODE_ENV || 'development'}.env.local` })

console.log('Environment:', process.env.NODE_ENV)

import { createMomentWithUser } from './controller'
import { User, UserType } from './model'
import { client as claudeAI } from '../../utils/claudeAI'
import { client as openAI, client } from '../../utils/openAI'
import { matchingPrompts, summaryPrompts } from '../matches/prompts'
import {
	createMomentImage,
	createMomentImageWithOpenAIv2,
	createMeetingDateSummaryUsingClaude,
	createMeetingDateSummaryUsingGemini,
	createMeetingDateSummary,
	isValidUserIdFormat,
	extractParametersFromBody,
	getProfileImageFilename,
	getMeetingDateImageFilename,
} from '../../utils/user/helper'
import { parseAImodelResponse, storeMoment } from '../moment/controller'
import { generateS3GetPresignedUrl } from '../../utils/aws'
import * as momentUtils from '../../utils/user/moment'
import { config } from '../../constants'
import { ApiError } from '../../utils'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedCreateMomentImageWithOpenAIv2 = vi.mocked(createMomentImageWithOpenAIv2)
const mockedCreateMomentImage = vi.mocked(createMomentImage)

const fullMomentSummary = {
	summary: 'test summary',
	summary_b: 'test summary b',
	title: 'Test Date',
	location: 'Test Location',
	items: ['item1', 'item2'],
	mood: 'romantic',
	scene: 'A softly lit mini golf course at dusk.',
	opening_line: 'You both smiled at the first hole.',
	ending_note: 'You both agreed to do this again soon.',
	moment: 'A shared laugh when one putt ricocheted off the bumper.',
	reflections: ['They stayed relaxed', 'The pace felt easy'],
	pay_attention_to: ['Shared humor', 'Gentle pacing'],
	final_why: {
		observations: ['It was a relaxed and enjoyable date with shared humor and easy pacing.'],
		insight: 'The date felt steady and warm with easy back-and-forth.',
	},
	chemistry_signals: 'Shared ease and a few quick laughs.',
	conversational_balance: 'Both people took turns and kept the pace even.',
	conversation_flow: 'The conversation moved naturally from small talk into shared interests.',
	curiosity: 'Each person asked follow-up questions.',
	energy_alignment: 'Their energy stayed calm and matched the venue.',
	humor_alignment: 'The humor landed cleanly and kept things light.',
	listening_responsiveness: 'Each person picked up on the other’s cues.',
	repair_attempts: 'A small stumble was corrected with an easy laugh.',
	responsiveness: 'Both people acknowledged each other’s comments.',
	shared_moments: 'They both reacted to the same playful moment.',
	tension_handling: 'Any friction was resolved quickly without lingering.',
	compatibility_penalty: '0 points',
	match_score: '78/100',
	gpt_score: '80/100',
	tone_score: '8/10',
	tags: ['warm', 'steady', 'playful'],
	flags: {
		green: ['easy rhythm'],
		yellow: ['slight hesitation at the start'],
		red: [],
	},
	tone_trend: 'steady_warm',
	avg_match_score: 78,
}

vi.mock('./model')
vi.mock('../../utils/claudeAI')
vi.mock('../../utils/openAI')
vi.mock('../matches/prompts')
vi.mock('../../utils/user/helper')
vi.mock('../moment/controller')
vi.mock('../../utils/aws')
vi.mock('../../constants')
vi.mock('../../utils')
vi.mock('openai')
vi.mock('../learning/model', () => ({
	default: {
		find: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
	},
}))

describe('createMomentWithUser', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		req = {
			query: { user_target: '507f1f77bcf86cd799439013' },
			requester: {
				_id: '507f1f77bcf86cd799439011',
				core_answers: ['Answer1', 'Answer2', 'Answer3', 'Answer4', 'Answer5'],
			},
		}
		res = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn(),
		}
		next = vi.fn()

		const createOpenAIMock = vi.fn().mockResolvedValue({
			id: 'resp_123',
			created_at: new Date().toISOString(),
			output_text: 'OpenAI response',
			error: null,
			model: 'gpt-4.1',
			status: 'completed' as const,
			output: [
				{
					type: 'message',
					content: [{ type: 'output_text', text: 'OpenAI response' }],
				},
			],
			usage: { input_tokens: 50, output_tokens: 100 },
			request_id: 'req_123',
			processing_time_ms: 1000,
			warnings: [],
			metadata: {},
			provider: 'openai',
		})
		vi.mocked(OpenAI).mockImplementation(() => {
			return {
				responses: {
					create: createOpenAIMock,
				},
			} as unknown as OpenAI
		})

		// Mock config
		vi.mocked(config).claude = {
			enabled: true,
			apiKey: 'test-api-key',
			model: 'claude-3',
			maxTokens: 1000,
			temperature: 0.7,
			topP: 0.9,
			stopSequences: [],
		}

		// Mock prompts
		vi.mocked(summaryPrompts).v3_2_3 = {
			requiresTranscript: false,
			prompt: 'test summary prompt',
			allowedParameters: [],
			getUsersInformation: vi.fn().mockReturnValue('summary user info'),
		}
		vi.mocked(summaryPrompts).v4 = {
			requiresTranscript: false,
			prompt: 'test summary prompt v4',
			allowedParameters: [],
			getUsersInformation: vi.fn().mockReturnValue('summary user info v4'),
		}
		vi.mocked(summaryPrompts).v3 = {
			requiresTranscript: false,
			prompt: 'test summary prompt v3',
			allowedParameters: [],
			getUsersInformation: vi.fn().mockReturnValue('summary user info v3'),
		}
		vi.mocked(matchingPrompts).v3_2 = {
			getUsersInformation: vi.fn().mockReturnValue('user info'),
			prompt: 'test prompt',
		}
		vi.mocked(matchingPrompts).v3_1 = {
			getUsersInformation: vi.fn().mockReturnValue('user info v3_1'),
			prompt: 'test prompt v3_1',
		}

		// Mock functions
		vi.mocked(isValidUserIdFormat).mockReturnValue(true)
		vi.mocked(extractParametersFromBody).mockReturnValue({})
		vi.mocked(createMeetingDateSummaryUsingClaude).mockResolvedValue({
			summary: fullMomentSummary,
		} as any)
		vi.mocked(createMeetingDateSummaryUsingGemini).mockResolvedValue({
			summary: fullMomentSummary,
		} as any)
		vi.mocked(createMeetingDateSummary).mockResolvedValue({
			summary: fullMomentSummary,
		} as any)
		vi.spyOn(momentUtils, 'processAIDateResponse').mockResolvedValue({
			reply: '```json\n{"journal":["Journal entry 1"],"gptScore":"8","toneScore":"7","matchScore":"9","tags":["romantic"]}\n```',
			claudeResponse: { usage: { input_tokens: 100, output_tokens: 200 } },
		} as any)
		vi.spyOn(momentUtils, 'buildDateResponse').mockResolvedValue({
			success: true,
			message: 'Date created successfully with user',
		} as any)
		vi.mocked(parseAImodelResponse).mockReturnValue({
			journal: ['Journal entry 1'],
			gptScore: '8',
			toneScore: '7',
			matchScore: '9',
			tags: ['romantic'],
		})
		vi.mocked(storeMoment).mockResolvedValue({
			_id: 'meet123',
			...fullMomentSummary,
			model: 'claude-3',
			provider: 'claude',
			journal_a: ['Journal entry 1'],
			journal_b: ['Journal entry 1b'],
			tags: ['romantic'],
			version: 'v1',
			when: new Date(),
		} as any)
		vi.mocked(generateS3GetPresignedUrl).mockReturnValue('https://presigned-url.com')
		vi.mocked(getProfileImageFilename).mockReturnValue('profile.jpg')
		vi.mocked(createMomentImageWithOpenAIv2).mockResolvedValue({
			dateMeetingPresignedUrl: 'https://image-url.com',
			userApresignedUrl: 'https://user-a-avatar.com',
			userBpresignedUrl: 'https://user-b-avatar.com',
			inputTokens: 10,
			outputTokens: 20,
		})
		vi.mocked(createMomentImage).mockResolvedValue({
			dateMeetingPresignedUrl: 'https://image-url.com',
			userApresignedUrl: 'https://user-a-avatar.com',
			userBpresignedUrl: 'https://user-b-avatar.com',
			inputTokens: 10,
			outputTokens: 20,
		})
	})

	it('should create date successfully', async () => {
		const targetUser = {
			_id: '507f1f77bcf86cd799439013',
			first_name: 'Jane',
			core_answers: ['TargetAnswer1', 'TargetAnswer2', 'TargetAnswer3', 'TargetAnswer4', 'TargetAnswer5'],
		}
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue(targetUser),
		} as any)
		vi.mocked(getMeetingDateImageFilename).mockReturnValue('date.jpg')
		vi.mocked(generateS3GetPresignedUrl).mockImplementation((key: string) => `https://presigned-url.com/${key}`)
		vi.mocked(getProfileImageFilename).mockImplementation((user: UserType) => `profile-${user._id}.jpg`)

		req.query.matchingPromptVersion = 'v3_2'
		req.query.summaryPromptVersion = 'v3_2_3'

		const mockClaudeResponse = {
			id: 'msg_123',
			model: 'claude-3',
			role: 'assistant' as const,
			content: [{ type: 'text' as const, text: 'AI generated response' }],
			stop_reason: 'end_turn' as const,
			stop_sequence: null,
			usage: { input_tokens: 100, output_tokens: 200 },
		}
		vi.mocked(claudeAI?.messages.create)?.mockResolvedValue(mockClaudeResponse as any)
		vi.spyOn(momentUtils, 'buildDateResponse').mockResolvedValueOnce({
			success: true,
			message: 'Date created successfully with user',
			data: {
				model: 'claude-3',
				provider: 'claude',
				journal_a: ['Journal entry 1'],
				journal_b: ['Journal entry 1b'],
			},
		} as any)

		await createMomentWithUser(req, res, next)

		expect(User.findOne).toHaveBeenCalledWith({ _id: '507f1f77bcf86cd799439013' })
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				message: 'Date created successfully with user',
				data: expect.objectContaining({
					model: 'claude-3',
					provider: 'claude',
					journal_a: ['Journal entry 1'],
					journal_b: ['Journal entry 1b'],
				}),
			}),
		)
		expect(next).not.toHaveBeenCalled()
	})

	it('should pass query email to date target validator', async () => {
		const targetUser = {
			_id: '507f1f77bcf86cd799439013',
			first_name: 'Jane',
			core_answers: ['TargetAnswer1', 'TargetAnswer2', 'TargetAnswer3', 'TargetAnswer4', 'TargetAnswer5'],
		}
		req.query.email = 'target@example.com'

		const validateDateRequestSpy = vi.spyOn(momentUtils, 'validateDateRequest').mockImplementation(() => {})
		const validateDateTargetUserSpy = vi.spyOn(momentUtils, 'validateDateTargetUser').mockResolvedValue(targetUser as any)

		await createMomentWithUser(req, res, next)

		expect(validateDateTargetUserSpy).toHaveBeenCalledWith('507f1f77bcf86cd799439013', 'target@example.com')
		expect(res.status).toHaveBeenCalledWith(200)
		expect(next).not.toHaveBeenCalled()
		validateDateTargetUserSpy.mockRestore()
		validateDateRequestSpy.mockRestore()
	})

	it('should call date target validator with undefined email when query email is omitted', async () => {
		const targetUser = {
			_id: '507f1f77bcf86cd799439013',
			first_name: 'Jane',
			core_answers: ['TargetAnswer1', 'TargetAnswer2', 'TargetAnswer3', 'TargetAnswer4', 'TargetAnswer5'],
		}

		const validateDateRequestSpy = vi.spyOn(momentUtils, 'validateDateRequest').mockImplementation(() => {})
		vi.spyOn(momentUtils, 'validateDateTargetUser').mockResolvedValue(targetUser as any)

		await createMomentWithUser(req, res, next)

		expect(validateDateRequestSpy).toHaveBeenCalledWith(req, '507f1f77bcf86cd799439013')
		expect(res.status).toHaveBeenCalledWith(200)
		expect(next).not.toHaveBeenCalled()
		validateDateRequestSpy.mockRestore()
	})

	it('should handle missing user_target', async () => {
		req.query.user_target = undefined

		await createMomentWithUser(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('Missing user_target parameter', 'createMomentWithUser'))
		expect(res.status).not.toHaveBeenCalled()
	})

	it('should prevent creating date with self', async () => {
		req.query.user_target = '507f1f77bcf86cd799439011' // same as requester

		await createMomentWithUser(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('Cannot create a date with yourself', 'createMomentWithUser'))
		expect(res.status).not.toHaveBeenCalled()
	})

	it('should handle insufficient requester answers', async () => {
		req.requester.core_answers = ['Answer1', 'Answer2'] // less than 5

		await createMomentWithUser(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('Not all required values were provided by requester', 'createMomentWithUser'))
		expect(res.status).not.toHaveBeenCalled()
	})

	it('should handle target user not found', async () => {
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue(null),
		} as any)

		await createMomentWithUser(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.notFound('Target user not found', 'createMomentWithUser'))
		expect(res.status).not.toHaveBeenCalled()
	})

	it('should handle insufficient target user answers', async () => {
		const targetUser = {
			_id: '507f1f77bcf86cd799439013',
			core_answers: ['Answer1', 'Answer2'], // less than 5
		}
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue(targetUser),
		} as any)

		await createMomentWithUser(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('Not all required values were provided by target user', 'createMomentWithUser'))
		expect(res.status).not.toHaveBeenCalled()
	})

	it('should handle Claude API rate limit and fallback to OpenAI', async () => {
		const targetUser = {
			_id: '507f1f77bcf86cd799439013',
			first_name: 'Jane',
			core_answers: ['TargetAnswer1', 'TargetAnswer2', 'TargetAnswer3', 'TargetAnswer4', 'TargetAnswer5'],
		}
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue(targetUser),
		} as any)

		vi.mock('../../utils/claudeAI', () => ({
			client: {
				messages: {
					create: vi.fn(),
				},
			},
		}))
		const claudeError = new Anthropic.APIError(529, 'Rate limit exceeded', 'rate_limit_exceeded', null as any)
		vi.mocked(claudeAI?.messages.create)?.mockRejectedValue(claudeError)

		const mockOpenAIResponse = {
			id: 'resp_123',
			created_at: new Date().toISOString(),
			output_text: 'OpenAI response',
			error: null,
			model: 'gpt-4.1',
			status: 'completed' as const,
			output: [
				{
					type: 'message',
					content: [{ type: 'output_text', text: 'OpenAI response' }],
				},
			],
			usage: { input_tokens: 50, output_tokens: 100 },
			request_id: 'req_123',
			processing_time_ms: 1000,
			warnings: [],
			metadata: {},
			provider: 'openai',
		}
		vi.mock('../../utils/openAI', () => ({
			client: {
				responses: {
					create: vi.fn(),
				},
			},
		}))
		vi.mocked(openAI?.responses.create)?.mockResolvedValue(mockOpenAIResponse as any)
		req.query.matchingPromptVersion = 'v1'
		req.query.summaryPromptVersion = 'v1'

		await createMomentWithUser(req, res, next)

		expect(momentUtils.processAIDateResponse).toHaveBeenCalled()
		expect(res.status).toHaveBeenCalledWith(200)
	})

	it('should handle Claude API error (non-rate limit)', async () => {
		const targetUser = {
			_id: '507f1f77bcf86cd799439013',
			core_answers: ['TargetAnswer1', 'TargetAnswer2', 'TargetAnswer3', 'TargetAnswer4', 'TargetAnswer5'],
		}
		vi.spyOn(momentUtils, 'validateDateRequest').mockImplementation(() => {})
		vi.spyOn(momentUtils, 'validateDateTargetUser').mockResolvedValue(targetUser as any)

		vi.spyOn(momentUtils, 'processAIDateResponse').mockRejectedValue(new Error('API Error'))

		req.query.matchingPromptVersion = 'v1'
		req.query.summaryPromptVersion = 'v3'
		await createMomentWithUser(req, res, next)

		expect(next).toHaveBeenCalled()
		expect(res.status).not.toHaveBeenCalled()
	})

	it('should skip date image when skip_date_image is true', async () => {
		req.query.skip_date_image = 'true'
		const targetUser = {
			_id: '507f1f77bcf86cd799439013',
			first_name: 'Jane',
			core_answers: ['TargetAnswer1', 'TargetAnswer2', 'TargetAnswer3', 'TargetAnswer4', 'TargetAnswer5'],
		}
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue(targetUser),
		} as any)

		const mockClaudeResponse = {
			id: 'msg_789',
			model: 'claude-3',
			role: 'assistant' as const,
			content: [{ type: 'text' as const, text: 'AI generated response' }],
			stop_reason: 'end_turn' as const,
			stop_sequence: null,
			usage: { input_tokens: 100, output_tokens: 200 },
		}
		vi.mocked(claudeAI?.messages.create)?.mockResolvedValue(mockClaudeResponse as any)

		await createMomentWithUser(req, res, next)

		expect(createMomentImageWithOpenAIv2).not.toHaveBeenCalled()
		expect(createMomentImage).not.toHaveBeenCalled()
		expect(res.status).toHaveBeenCalledWith(200)
	})

	it('should create date image when skip_date_image is false', async () => {
		req.query.skip_date_image = 'false'
		const targetUser = {
			_id: '507f1f77bcf86cd799439013',
			first_name: 'Jane',
			core_answers: ['TargetAnswer1', 'TargetAnswer2', 'TargetAnswer3', 'TargetAnswer4', 'TargetAnswer5'],
		}
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue(targetUser),
		} as any)

		const mockClaudeResponse = {
			id: 'msg_101112',
			model: 'claude-3',
			role: 'assistant' as const,
			content: [
				{
					type: 'text' as const,
					text:
						'```json\n```{"journal":["Journal entry 1"],"gptScore":"8","toneScore":"7","matchScore":"9","tags":["romantic"],"dateMeetingPresignedUrl":"XXXXXXXXXXXXXXXXXXXXX","userApresignedUrl":"XXXXXXXXXXXXXXXXXXXXXXXXX","userBpresignedUrl":"XXXXXXXXXXXXXXXXXXXXXXXXX","inputTokens":10,"outputTokens":20}```',
				},
			],
			stop_reason: 'end_turn' as const,
			stop_sequence: null,
			usage: { input_tokens: 100, output_tokens: 200 },
		}
		vi.mocked(claudeAI?.messages.create)?.mockResolvedValue(mockClaudeResponse as any)
		vi.mocked(parseAImodelResponse).mockReturnValue({
			journal: ['Journal entry 1'],
			gptScore: '8',
			toneScore: '7',
			matchScore: '9',
			tags: ['romantic'],
		})
		await createMomentWithUser(req, res, next)

		expect(mockedCreateMomentImageWithOpenAIv2.mock.calls.length + mockedCreateMomentImage.mock.calls.length).toBeGreaterThan(0)
		expect(res.status).toHaveBeenCalledWith(200)
	})

	it('should create date image when skip_image is false', async () => {
		req.query.skip_image = 'false'
		const targetUser = {
			_id: '507f1f77bcf86cd799439013',
			first_name: 'Jane',
			core_answers: ['TargetAnswer1', 'TargetAnswer2', 'TargetAnswer3', 'TargetAnswer4', 'TargetAnswer5'],
		}
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue(targetUser),
		} as any)

		const mockClaudeResponse = {
			id: 'msg_skip_image_false',
			model: 'claude-3',
			role: 'assistant' as const,
			content: [
				{
					type: 'text' as const,
					text:
						'```json\n```{"journal":["Journal entry 1"],"gptScore":"8","toneScore":"7","matchScore":"9","tags":["romantic"],"dateMeetingPresignedUrl":"XXXXXXXXXXXXXXXXXXXXX","userApresignedUrl":"XXXXXXXXXXXXXXXXXXXXXXXXX","userBpresignedUrl":"XXXXXXXXXXXXXXXXXXXXXXXXX","inputTokens":10,"outputTokens":20}```',
				},
			],
			stop_reason: 'end_turn' as const,
			stop_sequence: null,
			usage: { input_tokens: 100, output_tokens: 200 },
		}
		vi.mocked(claudeAI?.messages.create)?.mockResolvedValue(mockClaudeResponse as any)
		vi.mocked(parseAImodelResponse).mockReturnValue({
			journal: ['Journal entry 1'],
			gptScore: '8',
			toneScore: '7',
			matchScore: '9',
			tags: ['romantic'],
		})
		await createMomentWithUser(req, res, next)

		expect(mockedCreateMomentImageWithOpenAIv2.mock.calls.length + mockedCreateMomentImage.mock.calls.length).toBeGreaterThan(0)
		expect(res.status).toHaveBeenCalledWith(200)
	})

	it('should handle custom prompt versions', async () => {
		req.query.matchingPromptVersion = 'v3_1'
		req.query.summaryPromptVersion = 'v3'

		vi.mocked(matchingPrompts).v3_1 = {
			getUsersInformation: vi.fn().mockReturnValue('custom user info'),
			prompt: 'custom prompt',
		}
		const targetUser = {
			_id: '507f1f77bcf86cd799439013',
			first_name: 'Jane',
			core_answers: ['TargetAnswer1', 'TargetAnswer2', 'TargetAnswer3', 'TargetAnswer4', 'TargetAnswer5'],
		}
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue(targetUser),
		} as any)

		await createMomentWithUser(req, res, next)

		expect(momentUtils.processAIDateResponse).toHaveBeenCalledWith(summaryPrompts.v3, matchingPrompts.v3_1, req.requester, expect.anything())
		expect(res.status).toHaveBeenCalledWith(200)
	})

	it('should handle storeMoment error gracefully', async () => {
		const targetUser = {
			_id: '507f1f77bcf86cd799439013',
			first_name: 'Jane',
			core_answers: ['TargetAnswer1', 'TargetAnswer2', 'TargetAnswer3', 'TargetAnswer4', 'TargetAnswer5'],
		}
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue(targetUser),
		} as any)

		const mockClaudeResponse = {
			id: 'msg_error_test',
			model: 'claude-3',
			role: 'assistant' as const,
			content: [
				{
					type: 'text' as const,
					text: JSON.stringify({
						journal: ['Test journal'],
						gpt_score: '8',
						tone_score: '7',
						match_score: '9',
						tags: ['test'],
					}),
				},
			],
			stop_reason: 'end_turn' as const,
			stop_sequence: null,
			usage: { input_tokens: 100, output_tokens: 200 },
		}
		vi.mocked(claudeAI?.messages.create)?.mockResolvedValue(mockClaudeResponse as any)
		vi.mocked(parseAImodelResponse).mockReturnValue({
			journal: ['Test journal'],
			gptScore: '8',
			toneScore: '7',
			matchScore: '9',
			tags: ['test'],
		})
		vi.mocked(storeMoment).mockRejectedValue(new ApiError(500, 'Failed to store dating meet: ValidationError: avg_match_score: Cast to Number failed for value "NaN"', 'storeMoment'))

		await createMomentWithUser(req, res, next)

		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
		expect(next).toHaveBeenCalled()
	})

	it('should handle general errors', async () => {
		const error = new Error('Unexpected error')
		vi.spyOn(User, 'findOne').mockResolvedValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockRejectedValue(error),
		} as any)

		await createMomentWithUser(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.internal('Unexpected error', 'createMomentWithUser'))
	})
})
