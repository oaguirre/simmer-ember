import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateRelationship } from './controller'
import { Relationship } from './model'

vi.mock('./model', () => ({
	Relationship: {
		findOne: vi.fn(),
	},
}))

vi.mock('../../resources/user/model', () => ({
	User: {
		findOne: vi.fn(),
	},
}))

vi.mock('../../utils/user/helper', () => ({
	getAvatarFilename: vi.fn(),
	isValidUserIdFormat: vi.fn(() => true),
}))

describe('updateRelationship anniversary_date', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		vi.clearAllMocks()
		req = {
			params: { id: 'rel-1' },
			query: {},
			body: {},
			requester: { _id: '69f8d15fc353a737a7cbaa5d' },
		}
		res = {
			status: vi.fn().mockReturnThis(),
			send: vi.fn(),
		}
		next = vi.fn()
	})

	it('sets anniversary_date when provided as valid ISO date', async () => {
		const relationship = {
			_id: 'rel-1',
			user_a: '69f8d15fc353a737a7cbaa5d',
			user_b: '69f8d15fc353a737a7cbaa7f',
			type: 'dating',
			status: 'ongoing',
			stage: 'exclusive',
			save: vi.fn().mockResolvedValue(undefined),
		} as any
		vi.mocked(Relationship.findOne).mockResolvedValue(relationship)
		req.body = { anniversary_date: '2025-01-10T00:00:00.000Z' }

		await updateRelationship(req, res, next)

		expect(relationship.anniversary_date).toBeInstanceOf(Date)
		expect(relationship.save).toHaveBeenCalledTimes(1)
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.send).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				data: expect.objectContaining({ anniversary_date: expect.any(Date) }),
			}),
		)
		expect(next).not.toHaveBeenCalled()
	})

	it('unsets anniversary_date when null is provided', async () => {
		const relationship = {
			_id: 'rel-1',
			user_a: '69f8d15fc353a737a7cbaa5d',
			user_b: '69f8d15fc353a737a7cbaa7f',
			type: 'dating',
			status: 'ongoing',
			stage: 'exclusive',
			anniversary_date: new Date('2025-01-10T00:00:00.000Z'),
			save: vi.fn().mockResolvedValue(undefined),
		} as any
		vi.mocked(Relationship.findOne).mockResolvedValue(relationship)
		req.body = { anniversary_date: null }

		await updateRelationship(req, res, next)

		expect(relationship.anniversary_date).toBeUndefined()
		expect(relationship.save).toHaveBeenCalledTimes(1)
		expect(res.status).toHaveBeenCalledWith(200)
		expect(next).not.toHaveBeenCalled()
	})
})
