import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateLearningsForMoment } from './learning'
import Learning from '../../resources/learning/model'
import { User } from '../../resources/user/model'
import { client as openAI } from '../openAI'

vi.mock('../../resources/learning/model', () => ({
	default: {
		findOne: vi.fn(),
		create: vi.fn(),
	},
}))

vi.mock('../../resources/user/model', () => ({
	User: {
		findById: vi.fn(),
	},
}))

vi.mock('../openAI', () => ({
	client: {
		responses: {
			create: vi.fn(),
		},
	},
}))

const mockAiResponse = {
	output: [
		{
			type: 'message',
			content: [
				{
					type: 'output_text',
					text: JSON.stringify({
						summary: 'summary',
						insights: ['insight1'],
						facts: ['fact1'],
						preferences: ['pref1'],
						avoidances: ['avoid1'],
						hypotheses: ['hyp1'],
					}),
				},
			],
		},
	],
}

describe('generateLearningsForMoment privacy behavior', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(openAI!.responses.create).mockResolvedValue(mockAiResponse as any)
		vi.mocked(User.findById).mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'user-a', first_name: 'A' }) } as any)
	})

	it('sets private_to_user=true when learning belongs to moment.user_a and moment is private_to_a', async () => {
		vi.mocked(Learning.findOne).mockResolvedValue(null as any)
		vi.mocked(Learning.create).mockResolvedValue({ _id: 'learning1' } as any)

		const moment = {
			_id: 'moment-1',
			user_a: 'user-a',
			user_b: 'user-b',
			private_to_a: true,
		} as any

		await generateLearningsForMoment(moment)

		expect(Learning.create).toHaveBeenCalledWith(
			expect.objectContaining({
				user_id: 'user-a',
				private_to_user: true,
			}),
		)
	})

	it('does not create learning when private_to_a and learning user matches moment.user_b', async () => {
		const moment = {
			_id: 'moment-2',
			user_a: 'user-a',
			user_b: 'user-b',
			private_to_a: true,
		} as any

		const result = await generateLearningsForMoment(moment, 'user-b')

		expect(result).toBeNull()
		expect(Learning.findOne).not.toHaveBeenCalled()
		expect(Learning.create).not.toHaveBeenCalled()
		expect(openAI!.responses.create).not.toHaveBeenCalled()
	})

	it('creates non-private learning when moment is not private_to_a', async () => {
		vi.mocked(Learning.findOne).mockResolvedValue(null as any)
		vi.mocked(Learning.create).mockResolvedValue({ _id: 'learning2' } as any)

		const moment = {
			_id: 'moment-3',
			user_a: 'user-a',
			user_b: 'user-b',
			private_to_a: false,
		} as any

		await generateLearningsForMoment(moment)

		expect(Learning.create).toHaveBeenCalledWith(
			expect.objectContaining({
				user_id: 'user-a',
				private_to_user: false,
			}),
		)
	})

	it('marks existing learning private_to_user=true when a private_to_a moment is added for user_a', async () => {
		const save = vi.fn().mockResolvedValue(undefined)
		const existingLearning = {
			private_to_user: false,
			reference_user_ids: [],
			insights: [],
			facts: [],
			preferences: [],
			avoidances: [],
			hypotheses: [],
			moment_ids: [],
			save,
		}

		vi.mocked(Learning.findOne).mockResolvedValue(existingLearning as any)

		const moment = {
			_id: 'moment-4',
			user_a: 'user-a',
			user_b: 'user-b',
			private_to_a: true,
		} as any

		await generateLearningsForMoment(moment)

		expect(existingLearning.private_to_user).toBe(true)
		expect(save).toHaveBeenCalledTimes(1)
		expect(Learning.create).not.toHaveBeenCalled()
	})

	it('keeps existing private_to_user=true when processing non-private moments', async () => {
		const save = vi.fn().mockResolvedValue(undefined)
		const existingLearning = {
			private_to_user: true,
			reference_user_ids: [],
			insights: [],
			facts: [],
			preferences: [],
			avoidances: [],
			hypotheses: [],
			moment_ids: [],
			save,
		}

		vi.mocked(Learning.findOne).mockResolvedValue(existingLearning as any)

		const moment = {
			_id: 'moment-5',
			user_a: 'user-a',
			user_b: 'user-b',
			private_to_a: false,
		} as any

		await generateLearningsForMoment(moment)

		expect(existingLearning.private_to_user).toBe(true)
		expect(save).toHaveBeenCalledTimes(1)
	})
})
