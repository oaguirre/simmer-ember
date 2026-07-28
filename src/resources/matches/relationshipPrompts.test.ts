import { beforeEach, describe, expect, it, vi } from 'vitest'

import { relationshipSummarizePrompts } from './relationshipPrompts'
import { User } from '../user/model'
import Learning from '../learning/model'
import { getApproxLocation, getUserCoreQAPairs, getUserDatesCount, getUserPriorDates, stripEmptyFields } from './prompts'

vi.mock('../user/model', () => ({
	User: {
		findById: vi.fn(),
	},
}))

vi.mock('../learning/model', () => ({
	default: {
		find: vi.fn(),
	},
}))

vi.mock('./prompts', () => ({
	getApproxLocation: vi.fn(),
	getUserCoreQAPairs: vi.fn(),
	getUserDatesCount: vi.fn(),
	getUserPriorDates: vi.fn(),
	stripEmptyFields: vi.fn(),
}))

describe('relationshipSummarizePrompts.v1.getRelationshipInput', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getUserDatesCount).mockResolvedValue(0 as any)
		vi.mocked(getUserPriorDates).mockResolvedValue([] as any)
		vi.mocked(getApproxLocation).mockReturnValue('Austin, TX' as any)
		vi.mocked(stripEmptyFields).mockImplementation((value: any) => value)
		vi.mocked(Learning.find).mockReturnValue({ sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([]) } as any)
	})

	it('hydrates sparse A/B users before building prompt input', async () => {
		const hydratedA = {
			_id: 'user-a',
			first_name: 'Alex',
			core_questions: ['Q1'],
			core_answers: ['A1'],
		}
		const hydratedB = {
			_id: 'user-b',
			first_name: 'Riley',
			core_questions: ['Q2'],
			core_answers: ['A2'],
		}
		vi
			.mocked(User.findById)
			.mockResolvedValueOnce(hydratedA as any)
			.mockResolvedValueOnce(hydratedB as any)
		vi.mocked(getUserCoreQAPairs).mockImplementation((user: any) => {
			if (!Array.isArray(user?.core_questions) || !Array.isArray(user?.core_answers)) {
				return []
			}
			return user.core_questions.map((question: string, index: number) => ({
				question,
				answer: user.core_answers[index],
			}))
		})

		const input = await relationshipSummarizePrompts.v1.getRelationshipInput(
			{
				user_a: 'user-a',
				user_b: 'user-b',
				type: 'dating',
				status: 'initial',
				stage: 'presented',
				tags: [],
			} as any,
			{ _id: 'user-a' } as any,
			{ _id: 'user-b' } as any,
		)

		expect(input.A).toBeDefined()
		expect(input.B).toBeDefined()
		expect(User.findById).toHaveBeenCalledWith('user-a')
		expect(User.findById).toHaveBeenCalledWith('user-b')
		expect(input.A!.first_name).toBe('Alex')
		expect(input.B!.first_name).toBe('Riley')
		expect(input.A!.location).toBe('Austin, TX')
		expect(input.B!.location).toBe('Austin, TX')
		expect(input.A!.questions_answers).toEqual([{ question: 'Q1', answer: 'A1' }])
		expect(input.B!.questions_answers).toEqual([{ question: 'Q2', answer: 'A2' }])
	})
})
