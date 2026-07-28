import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getMomentsCountPerRelationship } from './controller'
import { Relationship } from './model'
import { generateS3GetPresignedUrl } from '../../utils/aws'
import * as helper from '../../utils/user/helper'

vi.mock('./model', () => ({
	Relationship: {
		aggregate: vi.fn(),
	},
}))

vi.mock('../user/model', () => ({
	User: {
		findOne: vi.fn(),
	},
}))

vi.mock('../../utils/aws', () => ({
	generateS3GetPresignedUrl: vi.fn(),
}))

vi.mock('../../utils/user/helper', () => ({
	getAvatarFilename: vi.fn(),
	getAvatarFilenameResolved: vi.fn(),
	isValidUserIdFormat: vi.fn(() => true),
}))

describe('getMomentsCountPerRelationship', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		vi.clearAllMocks()
		req = {
			query: {},
			requester: { _id: '69f8d15fc353a737a7cbaa5d' },
		}
		res = {
			status: vi.fn().mockReturnThis(),
			send: vi.fn(),
		}
		next = vi.fn()
		vi.mocked(helper.getAvatarFilename).mockImplementation((id: string) => `avatar-${id}`)
		vi.mocked(helper.getAvatarFilenameResolved).mockImplementation((id: string) => Promise.resolve(`avatar-${id}`))
		vi.mocked(generateS3GetPresignedUrl).mockImplementation((filename: string) => `presigned-${filename}`)
	})

	it('should not leak sensitive fields from relationship user payload', async () => {
		vi.mocked(Relationship.aggregate).mockResolvedValue([
			{
				_id: 'rel-1',
				count: 3,
				status: 'presented',
				stage: 'presented',
				anniversary_date: new Date('2024-05-11T00:00:00.000Z'),
				user: {
					_id: 'user-b',
					first_name: 'Jane',
					email: 'private@example.com',
					phone: '+1234567890',
					loc_address: '123 Main St',
					loc_postal_code: '10001',
					date_of_birth: new Date('1990-01-01'),
				},
			},
		] as any)

		await getMomentsCountPerRelationship(req, res, next)

		expect(res.status).toHaveBeenCalledWith(200)
		const payload = vi.mocked(res.send).mock.calls[0][0]
		expect(payload.success).toBe(true)
		expect(payload.data).toHaveLength(1)
		expect(payload.data[0].user).toMatchObject({
			_id: 'user-b',
			first_name: 'Jane',
			presignedAvatarUrl: 'presigned-avatar-user-b',
		})
		expect(payload.data[0].user).not.toHaveProperty('email')
		expect(payload.data[0].user).not.toHaveProperty('phone')
		expect(payload.data[0].user).not.toHaveProperty('loc_address')
		expect(payload.data[0].user).not.toHaveProperty('loc_postal_code')
		expect(payload.data[0].user).not.toHaveProperty('date_of_birth')
		expect(payload.data[0]).toHaveProperty('anniversary_date')
		expect(next).not.toHaveBeenCalled()
	})
})
