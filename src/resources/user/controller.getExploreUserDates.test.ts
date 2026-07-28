import { getExploreUserDates } from './controller'
import dotenv from 'dotenv'
dotenv.config({ path: '../../../.env.test.local' })

import * as aws from '../../utils/aws'
import * as helper from '../../utils/user/helper'
import * as affinityUtils from '../../utils/user/exploreMatches'
import * as relationshipUtils from '../../utils/user/relationship'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../utils'
import { Moment } from '../moment/model'
import { User } from './model'
import { Relationship } from '../relationship/model'

const fn = vi.fn()

vi.mock('../../utils/aws')
vi.mock('../../utils')
vi.mock('../../utils/user/helper')
vi.mock('../../utils/user/moment')
vi.mock('../../constants')
vi.mock('../../utils/user/exploreMatches')
vi.mock('../../utils/user/relationship')

describe('getExploreUserDates', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		req = {
			requester: { _id: '69f8d15fc353a737a7cbaa5d' },
			query: {},
		}
		res = {
			status: vi.fn().mockReturnThis(),
			send: vi.fn(),
		}
		next = vi.fn()

		vi.mocked(helper.getAvatarFilename).mockImplementation((id: string) => `avatar-${id}`)
		vi.mocked(helper.getAvatarFilenameResolved).mockImplementation((id: string) => Promise.resolve(`avatar-${id}`))
		vi.mocked(aws.generateS3GetPresignedUrl).mockImplementation((key: string) => `presigned-${key}`)
		vi.mocked(affinityUtils.buildAffinityPipeline).mockReturnValue([{ $match: { _id: { $ne: '69f8d15fc353a737a7cbaa5d' } } }])
		vi.mocked(affinityUtils.buildWorstDatePipeline).mockReturnValue([{ $match: { _id: { $ne: '69f8d15fc353a737a7cbaa5d' } } }])
		vi.mocked(relationshipUtils.createOrUpdateRelationshipsForPresentedDates).mockResolvedValue(undefined as any)
	})

	it('should return explore user dates successfully', async () => {
		const mockExistingDates = [
			{ user_a: { _id: '69f8d15fc353a737a7cbaa5d' }, user_b: { _id: 'user456' } },
			{ user_a: { _id: 'user789' }, user_b: { _id: '69f8d15fc353a737a7cbaa5d' } },
		]
		const mockUserDates = [
			{
				_id: 'user999',
				_score: 85,
				first_name: 'john',
				loc_city: 'New York',
				loc_state: 'NY',
			},
		]

		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue(mockExistingDates),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(User, 'aggregate').mockReturnValue({
			skip: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue(mockUserDates),
		} as any)

		await getExploreUserDates(req, res, next)

		expect(Moment.find).toHaveBeenCalledWith({
			type: 'date',
			$or: [{ user_a: '69f8d15fc353a737a7cbaa5d' }, { user_b: '69f8d15fc353a737a7cbaa5d', private_to_a: false }],
		})
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.send).toHaveBeenCalledWith({
			success: true,
			data: [
				{
					_id: 'user999',
					_affinity: 85,
					first_name: 'John',
					loc_city: 'New York',
					loc_state: 'NY',
					presignedAvatarUrl: 'presigned-avatar-user999',
					distanceMiles: null,
				},
			],
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('should not leak sensitive fields in explore dates response', async () => {
		const mockUserDates = [
			{
				_id: 'user999',
				_score: 85,
				first_name: 'john',
				loc_city: 'New York',
				loc_state: 'NY',
				email: 'private@example.com',
				phone: '+1234567890',
				loc_address: '123 Main St',
				loc_postal_code: '10001',
				date_of_birth: new Date('1990-01-01'),
			},
		]

		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(User, 'aggregate').mockReturnValue({
			skip: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue(mockUserDates),
		} as any)

		await getExploreUserDates(req, res, next)

		const payload = vi.mocked(res.send).mock.calls[0][0]
		expect(payload.success).toBe(true)
		expect(payload.data).toHaveLength(1)
		expect(payload.data[0]).toMatchObject({
			_id: 'user999',
			_affinity: 85,
			first_name: 'John',
			loc_city: 'New York',
			loc_state: 'NY',
		})
		expect(payload.data[0]).not.toHaveProperty('email')
		expect(payload.data[0]).not.toHaveProperty('phone')
		expect(payload.data[0]).not.toHaveProperty('loc_address')
		expect(payload.data[0]).not.toHaveProperty('loc_postal_code')
		expect(payload.data[0]).not.toHaveProperty('date_of_birth')
	})

	it('should handle offset and limit parameters', async () => {
		req.query = { offset: '5', limit: '20' }

		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		const aggregateMock = {
			skip: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue([]),
		}
		vi.spyOn(User, 'aggregate').mockReturnValue(aggregateMock as any)

		await getExploreUserDates(req, res, next)

		expect(aggregateMock.skip).toHaveBeenCalledWith(5)
		expect(aggregateMock.limit).toHaveBeenCalledWith(20)
	})

	it('should include worst dates when requested', async () => {
		req.query = { worst: 'true' }

		const mockUserDates = [{ _id: 'user999', _score: 85, first_name: 'john', loc_city: 'NYC', loc_state: 'NY' }]
		const mockWorstDates = [{ _id: 'user888', _score: 15, first_name: 'jane', loc_city: 'LA', loc_state: 'CA' }]

		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi
			.spyOn(User, 'aggregate')
			.mockReturnValueOnce({
				skip: vi.fn().mockReturnThis(),
				limit: vi.fn().mockResolvedValue(mockUserDates),
			} as any)
			.mockReturnValueOnce({
				skip: vi.fn().mockReturnThis(),
				limit: vi.fn().mockResolvedValue(mockWorstDates),
			} as any)

		await getExploreUserDates(req, res, next)

		expect(affinityUtils.buildWorstDatePipeline).toHaveBeenCalledWith(
			req.requester,
			expect.objectContaining({
				avoidDuplicateIds: expect.any(Set),
			}),
		)

		expect(res.send).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				data: expect.any(Array),
				worst: [
					{
						_id: 'user888',
						_worst_affinity: 15,
						first_name: 'Jane',
						loc_city: 'LA',
						loc_state: 'CA',
						presignedAvatarUrl: 'presigned-avatar-user888',
						distanceMiles: null,
					},
				],
			}),
		)
	})

	it('should handle missing requester ID', async () => {
		req.requester._id = undefined

		await getExploreUserDates(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('Not all required values were provided', 'getExploreUserDates'))
		expect(res.status).not.toHaveBeenCalled()
	})

	it('should handle database errors', async () => {
		const dbError = new Error('Database error')
		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockRejectedValue(dbError),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(User, 'aggregate').mockReturnValue({
			skip: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue([]),
		} as any)

		await getExploreUserDates(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.internal('Database error', 'getExploreUserDates'))
		expect(res.status).not.toHaveBeenCalled()
	})

	it('should exclude existing dating partners', async () => {
		const mockExistingDates = [{ user_a: { _id: '69f8d15fc353a737a7cbaa5d' }, user_b: { _id: 'user456' } }]

		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue(mockExistingDates),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(User, 'aggregate').mockReturnValue({
			skip: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue([]),
		} as any)

		await getExploreUserDates(req, res, next)

		expect(affinityUtils.buildAffinityPipeline).toHaveBeenCalledWith(
			req.requester,
			expect.any(Set),
			expect.objectContaining({
				requireReciprocal: true,
				hardDistanceMiles: null,
				excludeDealBreakerIntersect: true,
				includeOnlyTestUsers: true,
			}),
		)
	})

	it('should handle empty results', async () => {
		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(User, 'aggregate').mockReturnValue({
			skip: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue([]),
		} as any)

		await getExploreUserDates(req, res, next)

		expect(res.send).toHaveBeenCalledWith({
			success: true,
			data: [],
		})
	})

	it('should capitalize first names correctly', async () => {
		const mockUserDates = [
			{ _id: 'user999', _score: 85, first_name: 'JOHN', loc_city: 'NYC', loc_state: 'NY' },
			{ _id: 'user888', _score: 75, first_name: 'mary', loc_city: 'LA', loc_state: 'CA' },
		]

		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(User, 'aggregate').mockReturnValue({
			skip: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue(mockUserDates),
		} as any)

		await getExploreUserDates(req, res, next)

		expect(res.send).toHaveBeenCalledWith({
			success: true,
			data: [expect.objectContaining({ first_name: 'John' }), expect.objectContaining({ first_name: 'Mary' })],
		})
	})

	it('should not return a date with yourself', async () => {
		const mockExistingDates = [{ user_a: { _id: '69f8d15fc353a737a7cbaa5d' }, user_b: { _id: 'user456' } }]
		const mockUserDates = [
			{
				_id: 'user465',
				_score: 85,
				first_name: 'Katie',
				loc_city: 'Fremont',
				loc_state: 'CA',
			},
		]

		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue(mockExistingDates),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(User, 'aggregate').mockReturnValue({
			skip: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue(mockUserDates),
		} as any)

		await getExploreUserDates(req, res, next)

		expect(Moment.find).toHaveBeenCalledWith({
			type: 'date',
			$or: [{ user_a: '69f8d15fc353a737a7cbaa5d' }, { user_b: '69f8d15fc353a737a7cbaa5d', private_to_a: false }],
		})
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.send).toHaveBeenCalledWith({
			success: true,
			data: [
				{
					_id: 'user465',
					_affinity: 85,
					first_name: 'Katie',
					loc_city: 'Fremont',
					loc_state: 'CA',
					presignedAvatarUrl: 'presigned-avatar-user465',
					distanceMiles: null,
				},
			],
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('should limit explore results to test users only when specified', async () => {
		req.query = { test_users_only: 'true' }

		const mockExistingDates: any[] = []
		const mockUserDates = [
			{
				_id: 'testuser1',
				_score: 90,
				_affinity: 90,
				first_name: 'Testy',
				loc_city: 'Union City',
				loc_state: 'CA',
			},
		]

		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue(mockExistingDates),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(User, 'aggregate').mockReturnValue({
			skip: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue(mockUserDates),
		} as any)

		await getExploreUserDates(req, res, next)

		expect(affinityUtils.buildAffinityPipeline).toHaveBeenCalledWith(
			req.requester,
			expect.any(Set),
			expect.objectContaining({
				includeOnlyTestUsers: true,
			}),
		)
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.send).toHaveBeenCalledWith({
			success: true,
			data: [
				{
					_id: 'testuser1',
					_affinity: 90,
					first_name: 'Testy',
					loc_city: 'Union City',
					loc_state: 'CA',
					presignedAvatarUrl: 'presigned-avatar-testuser1',
					distanceMiles: null,
				},
			],
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('should enable preference scoring by default in affinity options', async () => {
		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(User, 'aggregate').mockReturnValue({
			skip: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue([]),
		} as any)

		await getExploreUserDates(req, res, next)

		expect(affinityUtils.buildAffinityPipeline).toHaveBeenCalledWith(
			req.requester,
			expect.any(Set),
			expect.objectContaining({
				usePreferenceScoring: true,
			}),
		)
	})

	it('should disable preference scoring when use_preference_scoring=false is requested', async () => {
		req.query = { use_preference_scoring: 'false' }

		vi.spyOn(Moment, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(Relationship, 'find').mockReturnValue({
			lean: vi.fn().mockResolvedValue([]),
		} as any)
		vi.spyOn(User, 'aggregate').mockReturnValue({
			skip: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue([]),
		} as any)

		await getExploreUserDates(req, res, next)

		expect(affinityUtils.buildAffinityPipeline).toHaveBeenCalledWith(
			req.requester,
			expect.any(Set),
			expect.objectContaining({
				usePreferenceScoring: false,
			}),
		)
	})
})
