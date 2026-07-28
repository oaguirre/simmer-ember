import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addAdditionalQAToInput, getUserCoreQAPairs, summaryPrompts } from './prompts'
import { Moment } from '../moment/model'
import Learning from '../learning/model'
import { Relationship } from '../relationship/model'

vi.mock('../moment/model', () => ({
	Moment: {
		find: vi.fn(),
		countDocuments: vi.fn(),
	},
}))

vi.mock('../learning/model', () => ({
	default: {
		find: vi.fn(),
	},
}))

vi.mock('../relationship/model', () => ({
	Relationship: {
		findOne: vi.fn(),
	},
}))

describe('summaryPrompts.v4 relationship_state', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(Moment.countDocuments).mockReturnValue({ exec: vi.fn().mockResolvedValue(1) } as any)
		vi.mocked(Moment.find).mockReturnValue({
			sort: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			lean: vi.fn().mockReturnThis(),
			exec: vi.fn().mockResolvedValue([
				{
					location: 'Bookstore',
					tone_score: '8',
					opening_line: 'You both reached for the same travel book at the same time.',
					ending_note: 'See you soon',
					key_moments: ['Shared laugh'],
					scene: 'Quiet aisle with stacked travel guides.',
					moment: 'A shared pause over a travel atlas.',
					pay_attention_to: ['Travel books', 'Easy pacing'],
					final_why: 'The date felt warm and easy.',
					match_score: '80',
					items: ['books'],
					flags: { green: ['good flow'], yellow: [], red: [] },
					tags: ['warm'],
					summary_a: 'Summary',
					when: new Date('2025-01-15T00:00:00.000Z'),
				},
			]),
		} as any)
		vi.mocked(Learning.find).mockReturnValue({ sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([]) } as any)
		vi.mocked(Relationship.findOne).mockReturnValue({
			lean: vi.fn().mockResolvedValue({
				type: 'dating',
				status: 'ongoing',
				stage: 'exclusive',
				last_interaction: new Date('2025-01-14T20:15:00.000Z'),
				tags: ['warm', 'stable'],
				anniversary_date: new Date('2024-09-01T00:00:00.000Z'),
			}),
		} as any)
	})

	it('includes relationship metadata fields in relationship_state when available', async () => {
		const userA = {
			_id: '69f8d15fc353a737a7cbaa5d',
			first_name: 'Alex',
			core_questions: ['Q1'],
			core_answers: ['A1'],
		} as any
		const userB = {
			_id: '69f8d15fc353a737a7cbaa7f',
			first_name: 'Riley',
			core_questions: ['Q1'],
			core_answers: ['A1'],
		} as any

		const inputs = await summaryPrompts.v4.getUsersInformation(userA, userB)

		expect(inputs.relationship_state).toBeDefined()
		expect(inputs.relationship_state.type).toBe('dating')
		expect(inputs.relationship_state.state).toBe('ongoing')
		expect(inputs.relationship_state.stage).toBe('exclusive')
		expect(inputs.relationship_state.last_interaction).toEqual(new Date('2025-01-14T20:15:00.000Z'))
		expect(inputs.relationship_state.tags).toEqual(['warm', 'stable'])
		expect(inputs.relationship_state.anniversary_date).toEqual(new Date('2024-09-01T00:00:00.000Z'))
		expect(inputs.relationship_state.last_date.opening_line).toBe('You both reached for the same travel book at the same time.')
		expect(inputs.relationship_state.last_date.ending_note).toBe('See you soon')
		expect(inputs.relationship_state.prior_dates[0].opening_line).toBe('You both reached for the same travel book at the same time.')
	})

	it('normalizes prompt QA input from core_qa object and legacy arrays', () => {
		const pairs = getUserCoreQAPairs({
			core_questions: ['Q1'],
			core_answers: ['A1'],
			core_qa: {
				Q1: 'A1 updated',
				Q2: 'A2',
			},
		} as any)

		expect(pairs).toEqual(expect.arrayContaining([expect.objectContaining({ question: 'Q1', answer: 'A1 updated' }), expect.objectContaining({ question: 'Q2', answer: 'A2' })]))
	})

	it('keeps array compatibility while adding object map for additional prompt questions', () => {
		const updated = addAdditionalQAToInput(
			{
				questions_for_date: ['What is your favorite movie?'],
				my_answers_for_date: ['Alien'],
			},
			['What is your favorite movie?', 'What is your ideal weekend?'],
			['Arrival', 'Hiking'],
		)

		expect(updated.questions_for_date).toEqual(['What is your favorite movie?', 'What is your ideal weekend?'])
		expect(updated.my_answers_for_date).toEqual(['Arrival', 'Hiking'])
	})
})
