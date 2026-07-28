import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMoment, viewMoment, viewMomentById } from './controller'
import { Moment } from './model'
import { User } from '../user/model'
import { mapMomentForResponse } from '../../utils/user/moment'
import { ApiError } from '../../utils'

const { MomentMock } = vi.hoisted(() => {
	const ctor = vi.fn()
	;(ctor as any).find = vi.fn()
	;(ctor as any).findById = vi.fn()
	;(ctor as any).findOne = vi.fn()
	;(ctor as any).create = vi.fn()
	return { MomentMock: ctor }
})

vi.mock('./model', () => ({
	Moment: MomentMock,
	MomentTypeEnum: {},
}))
vi.mock('../user/model', () => ({
	User: {
		findById: vi.fn(),
		findOne: vi.fn(),
	},
}))
vi.mock('../../utils/user/moment', () => ({
	getShareableTokenForViewDateMeeting: vi.fn(),
	mapMomentForResponse: vi.fn(),
	summarizeMoment: vi.fn(),
	storeMoment: vi.fn(),
}))
vi.mock('../../utils', () => ({
	ApiError: {
		notFound: vi.fn((msg: string, ctx: string) => ({ statusCode: 404, message: msg, context: ctx })),
		forbidden: vi.fn((msg: string, ctx: string) => ({ statusCode: 403, message: msg, context: ctx })),
		internal: vi.fn((msg: string, ctx: string) => ({ statusCode: 500, message: msg, context: ctx })),
	},
}))

describe('moment read responses', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		vi.clearAllMocks()
		req = {
			params: { moment_id: 'moment123' },
			requester: { _id: 'userA' },
		}
		res = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn(),
		}
		next = vi.fn()
	})

	it('returns fat user objects from viewMoment even when a list item still carries raw participant ids', async () => {
		const requester = { _id: 'userA' }
		const mappedMoment = {
			_id: 'moment123',
			model: 'gpt-4.1',
			provider: 'openai',
			journal_a: ['journal entry a'],
			journal_b: ['journal entry b'],
			user_a: {
				_id: 'userA',
				first_name: 'A',
				avatar_url: 'avatar-a',
				image_url: 'image-a',
			},
			user_b: {
				_id: 'userB',
				first_name: 'B',
				avatar_url: 'avatar-b',
				image_url: 'image-b',
			},
		}

		req = {
			query: {},
			requester,
		}

		vi.mocked(Moment.find).mockReturnValue({
			sort: vi.fn().mockReturnValue({
				skip: vi.fn().mockReturnValue({
					limit: vi.fn().mockReturnValue({
						populate: vi.fn().mockReturnValue({
							populate: vi.fn().mockReturnValue({
								lean: vi.fn().mockResolvedValue([{ _id: 'moment123', user_a: 'userA', user_b: 'userB', when: new Date('2026-05-15T00:00:00.000Z') }]),
							}),
						}),
					}),
				}),
			}),
		})

		vi
			.mocked(User.findOne)
			.mockReturnValueOnce({
				lean: vi.fn().mockReturnThis(),
				populate: vi.fn().mockResolvedValue({ _id: 'userA', first_name: 'A' }),
			} as any)
			.mockReturnValueOnce({
				lean: vi.fn().mockReturnThis(),
				populate: vi.fn().mockResolvedValue({ _id: 'userB', first_name: 'B' }),
			} as any)

		vi.mocked(mapMomentForResponse).mockResolvedValue(mappedMoment as any)

		await viewMoment(req, res, next)

		expect(mapMomentForResponse).toHaveBeenCalledWith(
			expect.objectContaining({ _id: 'userA' }),
			expect.objectContaining({ _id: 'userB' }),
			expect.objectContaining({ _id: 'moment123', user_b: 'userB' }),
		)
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith({
			success: true,
			data: [mappedMoment],
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('skips moments with missing participants and returns the rest', async () => {
		const requester = { _id: 'userA' }
		const goodMoment = { _id: 'momentGood', user_a: 'userA', user_b: 'userB' }
		const badMoment = { _id: 'momentBad', user_a: 'userA', user_b: 'userDeleted' }
		const mappedGood = {
			_id: 'momentGood',
			model: 'claude-3',
			provider: 'claude',
			journal_a: ['good a'],
			journal_b: ['good b'],
			user_a: { _id: 'userA' },
			user_b: { _id: 'userB' },
		}

		req = { query: {}, requester }

		vi.mocked(Moment.find).mockReturnValue({
			sort: vi.fn().mockReturnValue({
				skip: vi.fn().mockReturnValue({
					limit: vi.fn().mockReturnValue({
						populate: vi.fn().mockReturnValue({
							populate: vi.fn().mockReturnValue({
								lean: vi.fn().mockResolvedValue([goodMoment, badMoment]),
							}),
						}),
					}),
				}),
			}),
		})

		// goodMoment: both participants resolve
		// badMoment: user_b (userDeleted) resolves to null
		vi
			.mocked(User.findOne)
			.mockReturnValueOnce({ lean: vi.fn().mockReturnThis(), populate: vi.fn().mockResolvedValue({ _id: 'userA' }) } as any) // goodMoment user_a
			.mockReturnValueOnce({ lean: vi.fn().mockReturnThis(), populate: vi.fn().mockResolvedValue({ _id: 'userB' }) } as any) // goodMoment user_b
			.mockReturnValueOnce({ lean: vi.fn().mockReturnThis(), populate: vi.fn().mockResolvedValue({ _id: 'userA' }) } as any) // badMoment user_a
			.mockReturnValueOnce({ lean: vi.fn().mockReturnThis(), populate: vi.fn().mockResolvedValue(null) } as any) // badMoment user_b missing

		vi.mocked(mapMomentForResponse).mockResolvedValue(mappedGood as any)

		await viewMoment(req, res, next)

		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith({ success: true, data: [mappedGood] })
		expect(mapMomentForResponse).toHaveBeenCalledTimes(1)
		expect(next).not.toHaveBeenCalled()
	})

	it('returns not found when moment does not exist', async () => {
		vi.mocked(Moment.findOne).mockReturnValue({
			lean: vi.fn().mockResolvedValue(null),
		} as any)

		await viewMomentById(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.notFound('Moment not found', 'viewMomentById'))
		expect(res.status).not.toHaveBeenCalled()
	})

	it('returns forbidden when requester is not part of the moment', async () => {
		vi.mocked(Moment.findOne).mockReturnValue({
			lean: vi.fn().mockResolvedValue({ _id: 'moment123', user_a: 'userX', user_b: 'userY' }),
		} as any)

		await viewMomentById(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.forbidden('You do not have access to this moment', 'viewMomentById'))
		expect(res.status).not.toHaveBeenCalled()
	})

	it('returns mapped moment data when requester has access', async () => {
		const moment = { _id: 'moment123', user_a: 'userA', user_b: 'userB' }
		const userA = { _id: 'userA', first_name: 'A' }
		const userB = { _id: 'userB', first_name: 'B' }

		vi.mocked(Moment.findOne).mockReturnValue({
			lean: vi.fn().mockResolvedValue(moment),
		} as any)

		vi
			.mocked(User.findOne)
			.mockReturnValueOnce({
				lean: vi.fn().mockReturnThis(),
				populate: vi.fn().mockResolvedValue(userA),
			} as any)
			.mockReturnValueOnce({
				lean: vi.fn().mockReturnThis(),
				populate: vi.fn().mockResolvedValue(userB),
			} as any)

		vi.mocked(mapMomentForResponse).mockResolvedValue({
			_id: 'moment123',
			summary_a: 'hello',
			model: 'gpt-4.1',
			provider: 'openai',
			journal_a: ['entry a'],
			journal_b: ['entry b'],
		} as any)

		await viewMomentById(req, res, next)

		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith({
			success: true,
			data: {
				_id: 'moment123',
				summary_a: 'hello',
				model: 'gpt-4.1',
				provider: 'openai',
				journal_a: ['entry a'],
				journal_b: ['entry b'],
			},
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('supports target_user alias in viewMoment query', async () => {
		req = {
			query: { target_user: 'userMissing' },
			requester: { _id: 'userA' },
		}

		vi.mocked(User.findOne).mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue(null),
		} as any)

		await viewMoment(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.notFound('Target user not found', 'viewMoment'))
		expect(res.status).not.toHaveBeenCalled()
	})

	it.each(['text', 'call', 'date'])('creates reality %s moments as private by default', async momentType => {
		const req: any = {
			requester: { _id: 'userA' },
			body: {
				user_b: 'userB',
				type: momentType,
				universe: 'reality',
				summary_a: 'already provided',
			},
		}
		const res: any = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn(),
		}
		const next = vi.fn()

		vi.mocked(User.findOne).mockResolvedValue({ _id: 'userB' } as any)

		const save = vi.fn().mockResolvedValue(undefined)
		;(Moment as any).mockImplementation(function (this: any, payload: any) {
			Object.assign(this, payload)
			this._id = 'moment123'
			this.save = save
			return this
		})

		vi.mocked(Moment.findOne as any).mockReturnValue({
			populate: vi.fn().mockReturnValue({
				populate: vi.fn().mockReturnValue({
					lean: vi.fn().mockResolvedValue({ _id: 'moment123', user_a: { _id: 'userA' }, user_b: { _id: 'userB' } }),
				}),
			}),
		} as any)

		vi.mocked(mapMomentForResponse).mockResolvedValue({ _id: 'moment123' } as any)

		await createMoment(req, res, next)

		expect(Moment).toHaveBeenCalledWith(
			expect.objectContaining({
				type: momentType,
				universe: 'reality',
				private_to_a: true,
			}),
		)
		expect(save).toHaveBeenCalled()
		expect(res.status).toHaveBeenCalledWith(201)
		expect(next).not.toHaveBeenCalled()
	})
})
