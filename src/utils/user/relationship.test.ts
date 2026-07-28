import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateRelationshipBasedOnDate } from './relationship'
import { Relationship } from '../../resources/relationship/model'
import { client as openAI } from '../../utils/openAI'
import { relationshipSummarizePrompts } from '../../resources/matches/relationshipPrompts'

vi.mock('../../resources/relationship/model', () => ({
	Relationship: {
		findOne: vi.fn(),
		create: vi.fn(),
		findByIdAndUpdate: vi.fn(),
	},
}))

vi.mock('../../resources/moment/controller', () => ({
	viewMoment: vi.fn(),
	viewMomentById: vi.fn(),
	shareMomentURL: vi.fn(),
	deleteMoment: vi.fn(),
	updateMoment: vi.fn(),
	createMoment: vi.fn(),
	extractScore: (value?: string) => {
		if (!value) return undefined
		const n = Number(value)
		return Number.isFinite(n) ? n : undefined
	},
}))

vi.mock('../../utils/openAI', () => ({
	client: {
		responses: {
			create: vi.fn(),
		},
	},
}))

vi.mock('../../resources/matches/relationshipPrompts', () => ({
	relationshipSummarizePrompts: {
		v1: {
			prompt: 'Summarize relationship',
			getRelationshipInput: vi.fn().mockResolvedValue('relationship-input'),
		},
	},
}))

describe('updateRelationshipBasedOnDate', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('creates relationship with short_term_memory as an array for first date', async () => {
		const when = new Date('2026-01-05T00:00:00.000Z')
		const moment = {
			user_a: { _id: '507f1f77bcf86cd799439011' },
			user_b: { _id: '507f1f77bcf86cd799439012' },
			when,
			title: 'First date',
			summary_a: 'Great conversation',
			summary_b: 'Nice vibe',
			flags: { green: ['kind'], yellow: [], red: [] },
			tone_score: '8',
			match_score: '7',
			key_moments: ['laughs'],
			final_why: { observations: ['Good potential'], insight: 'Good potential' },
			tags: ['date'],
		} as any

		vi.mocked(Relationship.findOne).mockReturnValue({
			sort: vi.fn().mockResolvedValue(null),
		} as any)
		vi.mocked(Relationship.create).mockResolvedValue({ _id: 'rel-1' } as any)

		await updateRelationshipBasedOnDate(moment)

		expect(Relationship.create).toHaveBeenCalledTimes(1)
		expect(Relationship.create).toHaveBeenCalledWith(
			expect.objectContaining({
				user_a: '507f1f77bcf86cd799439011',
				user_b: '507f1f77bcf86cd799439012',
				short_term_memory: [
					expect.objectContaining({
						when,
						title: 'First date',
						summary_a: 'Great conversation',
					}),
				],
			}),
		)
	})

	it('keeps latest short-term history and includes newest date in long-term yearly memory', async () => {
		const older = new Date('2026-02-01T00:00:00.000Z')
		const second = new Date('2026-03-01T00:00:00.000Z')
		const newest = new Date('2026-04-01T00:00:00.000Z')

		const existingRelationship = {
			_id: 'rel-1',
			stage: 'initial',
			status: 'initial',
			tags: ['existing'],
			notes: 'existing note',
			avg_match_score: 6,
			tone_trend: '6',
			short_term_memory: [
				{ when: older, summary_a: 'older', tone_score: '6', match_score: '6', key_moments: ['older-key'], final_why: { observations: ['older why'], insight: 'older why' } },
				{ when: second, summary_a: 'second', tone_score: '7', match_score: '7', key_moments: ['second-key'], final_why: { observations: ['second why'], insight: 'second why' } },
			],
			long_term_memory: [],
		} as any

		const moment = {
			user_a: { _id: '507f1f77bcf86cd799439011' },
			user_b: { _id: '507f1f77bcf86cd799439012' },
			when: newest,
			title: 'Third date',
			summary_a: 'third summary',
			summary_b: 'third summary b',
			flags: { green: ['chemistry'], yellow: [], red: [] },
			tone_score: '8',
			match_score: '9',
			key_moments: ['new-key'],
			final_why: { observations: ['new why'], insight: 'new why' },
			tags: ['third'],
		} as any

		vi.mocked(Relationship.findOne).mockReturnValue({
			sort: vi.fn().mockResolvedValue(existingRelationship),
		} as any)
		vi.mocked(Relationship.findByIdAndUpdate).mockResolvedValue(null as any)

		await updateRelationshipBasedOnDate(moment)

		expect(Relationship.findByIdAndUpdate).toHaveBeenCalledTimes(1)
		const [, update] = vi.mocked(Relationship.findByIdAndUpdate).mock.calls[0]

		expect(update.short_term_memory).toHaveLength(3)
		expect(update.short_term_memory.map((m: any) => new Date(m.when).toISOString())).toContain(newest.toISOString())

		expect(update.long_term_memory).toHaveLength(1)
		expect(update.long_term_memory[0].year).toBe(2026)
		expect(update.long_term_memory[0].relevant_dates.map((d: Date) => new Date(d).toISOString())).toContain(newest.toISOString())
	})

	it('parses fenced JSON digest output and saves relationship digest', async () => {
		const existingRelationship = {
			_id: 'rel-2',
			stage: 'matched',
			status: 'ongoing',
			tags: [],
			notes: '',
			avg_match_score: 7,
			tone_trend: '7',
			short_term_memory: [],
			long_term_memory: [],
		} as any

		const updatedRelationship = {
			_id: 'rel-2',
			tags: [],
			short_term_memory: [],
			long_term_memory: [],
			save: vi.fn().mockResolvedValue(undefined),
		} as any

		const moment = {
			_id: 'moment-1',
			user_a: { _id: '507f1f77bcf86cd799439011' },
			user_b: { _id: '507f1f77bcf86cd799439012' },
			when: new Date('2026-05-01T00:00:00.000Z'),
			title: 'Date summary',
			summary_a: 'Great date',
			summary_b: 'Nice connection',
			tone_score: '8',
			match_score: '8',
			flags: { green: [], yellow: [], red: [] },
			key_moments: ['laughing'],
			final_why: { observations: ['easy flow'], insight: 'positive trend' },
			tags: ['fun'],
		} as any

		vi.mocked(Relationship.findOne).mockReturnValue({
			sort: vi.fn().mockResolvedValue(existingRelationship),
		} as any)
		vi.mocked(Relationship.findByIdAndUpdate).mockResolvedValue(updatedRelationship)

		vi.mocked((openAI as any).responses.create).mockResolvedValue({
			output: [
				{
					type: 'message',
					content: [
						{
							type: 'output_text',
							text: '```json\n{"relationship_digest":{"state":"warming_up"}}\n```',
						},
					],
				},
			],
		} as any)

		await updateRelationshipBasedOnDate(moment)

		expect(relationshipSummarizePrompts.v1.getRelationshipInput).toHaveBeenCalled()
		expect(updatedRelationship.digest).toEqual({ state: 'warming_up' })
		expect(updatedRelationship.save).toHaveBeenCalledTimes(1)
	})
})
