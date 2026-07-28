import { beforeEach, describe, expect, it, vi } from 'vitest'

const { validateAndFormatFeedbackMock, generateLearningsForMomentMock } = vi.hoisted(() => ({
	validateAndFormatFeedbackMock: vi.fn(),
	generateLearningsForMomentMock: vi.fn(),
}))

vi.mock('./model', () => ({
	Moment: {
		findOne: vi.fn(),
	},
	MomentTypeEnum: {},
}))

vi.mock('../user/model', () => ({
	User: {
		findOne: vi.fn(),
	},
}))

vi.mock('../../utils/user/moment', () => ({
	getShareableTokenForViewDateMeeting: vi.fn(),
	mapMomentForResponse: vi.fn(),
	summarizeMoment: vi.fn(),
	validateAndFormatFeedback: validateAndFormatFeedbackMock,
}))

vi.mock('../../utils/user/learning', () => ({
	generateLearningsForMoment: generateLearningsForMomentMock,
}))

vi.mock('../../utils', () => ({
	ApiError: {
		badRequest: vi.fn((msg: string, ctx: string) => ({ statusCode: 400, message: msg, context: ctx })),
		notFound: vi.fn((msg: string, ctx: string) => ({ statusCode: 404, message: msg, context: ctx })),
		internal: vi.fn((msg: string, ctx: string) => ({ statusCode: 500, message: msg, context: ctx })),
	},
}))

import { updateMoment } from './controller'
import { Moment } from './model'
import { mapMomentForResponse } from '../../utils/user/moment'

describe('updateMoment feedback response', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns generated feedback fields and saves after formatting', async () => {
		let savedTitle: string | undefined
		const moment = {
			_id: 'moment123',
			type: 'date',
			feedback: [],
			save: vi.fn(async function (this: any) {
				savedTitle = this.feedback?.[0]?.title
			}),
		}

		const mappedMoment = {
			_id: 'moment123',
			type: 'date',
			feedback: [
				{
					source: 'user_a',
					target: 'relationship',
					validation_score: 8,
					comment: 'The energy was warm and the pacing felt comfortable.',
					title: 'Warm pacing',
					summary: 'The interaction felt warm and comfortable.',
					when: new Date('2026-05-14T00:00:00.000Z'),
				},
			],
		}

		const findOneMock = vi.mocked(Moment.findOne)
		findOneMock.mockReturnValue({
			populate: vi.fn().mockReturnValue({
				populate: vi.fn().mockReturnValue({
					lean: vi.fn().mockResolvedValue(moment as any),
				}),
			}),
		} as any)
		// First call returns the moment for feedback validation and saving
		findOneMock.mockResolvedValueOnce(moment as any)

		vi.mocked(mapMomentForResponse).mockResolvedValue(mappedMoment as any)
		validateAndFormatFeedbackMock.mockResolvedValue([
			{
				source: 'user_a',
				target: 'relationship',
				validation_score: 8,
				comment: 'The energy was warm and the pacing felt comfortable.',
				title: 'Warm pacing',
				summary: 'The interaction felt warm and comfortable.',
				when: new Date('2026-05-14T00:00:00.000Z'),
			},
		])
		generateLearningsForMomentMock.mockResolvedValue([])

		const req: any = {
			params: { moment_id: 'moment123' },
			body: {
				feedback: {
					validation_score: 8,
					comment: 'The energy was warm and the pacing felt comfortable.',
				},
			},
		}
		const res: any = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn(),
		}
		const next = vi.fn()

		await updateMoment(req, res, next)

		expect(validateAndFormatFeedbackMock).toHaveBeenCalledWith(moment, req.body.feedback)
		expect(generateLearningsForMomentMock).toHaveBeenCalledWith(moment)
		expect(moment.save).toHaveBeenCalledTimes(1)
		expect(savedTitle).toBe('Warm pacing')
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				data: expect.objectContaining({
					moment: expect.objectContaining({
						feedback: [
							expect.objectContaining({
								comment: 'The energy was warm and the pacing felt comfortable.',
								title: 'Warm pacing',
								summary: 'The interaction felt warm and comfortable.',
							}),
						],
					}),
				}),
			}),
		)
		expect(next).not.toHaveBeenCalled()
	})

	it('enriches an existing sparse feedback entry in the response', async () => {
		const moment = {
			_id: 'moment123',
			type: 'date',
			user_b: 'userB',
			universe: 'reality',
			feedback: [
				{
					_id: 'feedback123',
					source: 'user_a',
					target: 'personal',
				},
			],
			save: vi.fn(async function () {}),
		}

		const mappedMoment = {
			_id: 'moment123',
			type: 'date',
			user_b: 'userB',
			universe: 'reality',
			feedback: [
				{
					_id: 'feedback123',
					source: 'user_a',
					target: 'relationship',
					validation_score: 8,
					comment: 'The energy was warm and the pacing felt comfortable.',
					title: 'Warm pacing',
					summary: 'The interaction felt warm and comfortable.',
					when: new Date('2026-05-14T00:00:00.000Z'),
				},
			],
		}

		const findOneMock = vi.mocked(Moment.findOne)
		findOneMock.mockReturnValue({
			populate: vi.fn().mockReturnValue({
				populate: vi.fn().mockReturnValue({
					lean: vi.fn().mockResolvedValue(moment as any),
				}),
			}),
		} as any)
		// First call returns the moment for feedback validation and saving
		findOneMock.mockResolvedValueOnce(moment as any)

		vi.mocked(mapMomentForResponse).mockResolvedValue(mappedMoment as any)
		validateAndFormatFeedbackMock.mockImplementation(async (_moment: any, feedback: any) => {
			return [
				{
					_id: 'feedback123',
					source: 'user_a',
					target: 'relationship',
					validation_score: Number(feedback.validation_score),
					comment: feedback.comment,
					title: 'Warm pacing',
					summary: 'The interaction felt warm and comfortable.',
					when: new Date('2026-05-14T00:00:00.000Z'),
				},
			]
		})
		generateLearningsForMomentMock.mockResolvedValue([])

		const req: any = {
			params: { moment_id: 'moment123' },
			body: {
				feedback: {
					validation_score: 8,
					comment: 'The energy was warm and the pacing felt comfortable.',
				},
			},
		}
		const res: any = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn(),
		}
		const next = vi.fn()

		await updateMoment(req, res, next)

		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					moment: expect.objectContaining({
						feedback: [
							expect.objectContaining({
								_id: 'feedback123',
								source: 'user_a',
								target: 'relationship',
								comment: 'The energy was warm and the pacing felt comfortable.',
								title: 'Warm pacing',
								summary: 'The interaction felt warm and comfortable.',
							}),
						],
					}),
				}),
			}),
		)
		expect(next).not.toHaveBeenCalled()
	})
})
