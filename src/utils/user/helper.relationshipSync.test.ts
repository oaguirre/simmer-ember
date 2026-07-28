import { beforeEach, describe, expect, it, vi } from 'vitest'

import { syncInRelationshipWith } from './helper'
import { Relationship } from '../../resources/relationship/model'

vi.mock('../../resources/relationship/model', () => ({
	Relationship: {
		findOne: vi.fn(),
		findByIdAndUpdate: vi.fn(),
		findOneAndUpdate: vi.fn(),
	},
}))

describe('syncInRelationshipWith anniversary_date behavior', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('sets anniversary_date to today when setting relationship and it was missing', async () => {
		vi.mocked(Relationship.findOne).mockResolvedValueOnce({ _id: 'rel-new', stage: 'dating', anniversary_date: undefined } as any)
		vi.mocked(Relationship.findOneAndUpdate).mockResolvedValue({ _id: 'rel-new' } as any)

		await syncInRelationshipWith('69f8d15fc353a737a7cbaa5d', null, '69f8d15fc353a737a7cbaa7f')

		expect(Relationship.findOneAndUpdate).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				$set: expect.objectContaining({
					anniversary_date: expect.any(Date),
				}),
			}),
			expect.objectContaining({ upsert: true }),
		)
	})

	it('preserves existing anniversary_date when setting relationship', async () => {
		const existingAnniversary = new Date('2024-07-01T00:00:00.000Z')
		vi.mocked(Relationship.findOne).mockResolvedValueOnce({ _id: 'rel-existing', stage: 'exclusive', anniversary_date: existingAnniversary } as any)
		vi.mocked(Relationship.findOneAndUpdate).mockResolvedValue({ _id: 'rel-existing' } as any)

		await syncInRelationshipWith('69f8d15fc353a737a7cbaa5d', null, '69f8d15fc353a737a7cbaa7f')

		const [, update] = vi.mocked(Relationship.findOneAndUpdate).mock.calls[0]
		expect(update.$set.anniversary_date).toEqual(existingAnniversary)
	})

	it('unsets anniversary_date when relationship is removed', async () => {
		vi.mocked(Relationship.findOne).mockResolvedValueOnce({ _id: 'rel-prev', stage: 'serious_relationship' } as any)
		vi.mocked(Relationship.findByIdAndUpdate).mockResolvedValue({ _id: 'rel-prev' } as any)

		await syncInRelationshipWith('69f8d15fc353a737a7cbaa5d', '69f8d15fc353a737a7cbaa7f', null)

		expect(Relationship.findByIdAndUpdate).toHaveBeenCalledWith(
			'rel-prev',
			expect.objectContaining({
				$unset: { anniversary_date: 1 },
			}),
			expect.objectContaining({ runValidators: true }),
		)
		expect(Relationship.findOneAndUpdate).not.toHaveBeenCalled()
	})
})
