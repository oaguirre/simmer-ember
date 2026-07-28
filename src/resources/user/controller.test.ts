/* eslint-disable import/first */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable no-unexpected-multiline */
/* eslint-disable @typescript-eslint/func-call-spacing */
import dotenv, { populate } from 'dotenv'
dotenv.config({ path: '../../../.env.test.local' })

import { viewProfile, updateProfile, recreateAvatar } from './controller'
import { User } from './model'
import { Moment } from '../moment/model'
import Media from '../media/model'
import Learning from '../learning/model'
import { Relationship } from '../relationship/model'
import * as aws from '../../utils/aws'
import * as helper from '../../utils/user/helper'
import * as momentUtils from '../../utils/user/moment'
import * as learningUtils from '../../utils/user/learning'
import { client as openAI } from '../../utils/openAI'
import { config } from '../../constants'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../utils'
import { updateUserCoreQA } from '../../utils/user/helper'

const fn = vi.fn()

vi.mock('./model')
// vi.mock('./controller')
vi.mock('../../utils/aws')
vi.mock('../../utils')
vi.mock('../../utils/user/helper')
vi.mock('../../utils/user/moment')
vi.mock('../../utils/user/learning')
vi.mock('../../constants')
vi.mock('../../utils/aws')

describe('viewProfile', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		vi.mocked(helper.isValidUserIdFormat).mockReturnValue(true)
		vi.mocked(helper.getAgeFromDOB).mockReturnValue(33)
		vi.mocked(helper.populateMediaToUser).mockImplementation((user: any) => user)
		vi.mocked(aws.generateS3GetPresignedUrl).mockImplementation((key: string) => `presigned-url-for-${key}`)
		vi.mocked(helper.getProfileImageFilename).mockImplementation((user: any) => `profile-image-filename-for-${user._id}`)
		vi.mocked(helper.getAvatarFilename).mockImplementation((id: string) => `avatar-img-${id}`)
		if (openAI) {
			vi.mocked(openAI.responses.create).mockResolvedValue({ data: [{ text: 'Some response' }] } as any)
		}
		req = {
			query: {},
			requester: { _id: '507f1f77bcf86cd799439011' },
			params: {},
			body: {},
		}
		res = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn().mockReturnThis(),
			send: vi.fn(),
		}
		next = vi.fn()
	})

	it('should return user profile when user_target is provided', async () => {
		req.query.user_target = '507f1f77bcf86cd799439012'
		const user = { _id: '507f1f77bcf86cd799439012', first_name: 'John' }
		const leanMock = vi.fn().mockResolvedValue(user)
		const populateMock = vi.fn().mockReturnValue({ lean: leanMock } as any)
		const selectMock = vi.fn().mockReturnValue({ populate: populateMock } as any)
		vi.spyOn(User, 'findOne').mockReturnValue({ select: selectMock } as any)

		await viewProfile(req, res, next)

		expect(User.findOne).toHaveBeenCalledWith({ _id: '507f1f77bcf86cd799439012' })
		expect(res.status).toHaveBeenCalledWith(200)
		expect(next).not.toHaveBeenCalled()
	})

	it('should use requester._id if user_target is not provided', async () => {
		const mockUser = { _id: '507f1f77bcf86cd799439011', first_name: 'Jane' }
		const leanMock = vi.fn().mockResolvedValue(mockUser)
		const populateMock = vi.fn().mockReturnValue({ lean: leanMock } as any)
		const selectMock = vi.fn().mockReturnValue({ populate: populateMock } as any)
		vi.spyOn(User, 'findOne').mockReturnValue({ select: selectMock } as any)
		vi.mocked(helper.getProfileImageFilename).mockResolvedValue((user: any) => `profile-image-filename-for-${user._id}`)
		vi.mocked(aws.generateS3GetPresignedUrl).mockImplementation((key: string) => `presigned-url-for-${key}`)

		await viewProfile(req, res, next)

		expect(User.findOne).toHaveBeenCalledWith({ _id: '507f1f77bcf86cd799439011' })
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
		expect(next).not.toHaveBeenCalled()
	})

	it('should call next with badRequest if no user_target and no requester._id', async () => {
		req.requester._id = undefined

		await viewProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('No target specified', 'viewProfile'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})

	it('should call next with notFound if user not found', async () => {
		const leanMock = vi.fn().mockResolvedValue(null)
		const populateMock = vi.fn().mockReturnValue({ lean: leanMock } as any)
		const selectMock = vi.fn().mockReturnValue({ populate: populateMock } as any)
		vi.spyOn(User, 'findOne').mockReturnValue({ select: selectMock } as any)

		await viewProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.notFound('User not found', 'viewProfile'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})

	it('should call next with internal error on exception', async () => {
		const leanMock = vi.fn().mockRejectedValue(new Error('DB error'))
		const populateMock = vi.fn().mockReturnValue({ lean: leanMock } as any)
		const selectMock = vi.fn().mockReturnValue({ populate: populateMock } as any)
		vi.spyOn(User, 'findOne').mockReturnValue({ select: selectMock } as any)

		await viewProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.internal('DB error', 'viewProfile'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})

	it('should select private fields for self profile', async () => {
		req.query.user_target = '507f1f77bcf86cd799439011'
		const user = { _id: '507f1f77bcf86cd799439011', first_name: 'Jane' }
		const leanMock = vi.fn().mockResolvedValue(user)
		const populateMock = vi.fn().mockReturnValue({ lean: leanMock } as any)
		const selectMock = vi.fn().mockReturnValue({ populate: populateMock } as any)
		vi.spyOn(User, 'findOne').mockReturnValue({ select: selectMock } as any)

		await viewProfile(req, res, next)

		expect(selectMock).toHaveBeenCalledWith(expect.arrayContaining(['+email', '+phone', '+date_of_birth']))
	})

	it('should exclude sensitive fields for public profile', async () => {
		req.query.user_target = '507f1f77bcf86cd799439012'
		const user = { _id: '507f1f77bcf86cd799439012', first_name: 'John' }
		const leanMock = vi.fn().mockResolvedValue(user)
		const populateMock = vi.fn().mockReturnValue({ lean: leanMock } as any)
		const selectMock = vi.fn().mockReturnValue({ populate: populateMock } as any)
		vi.spyOn(User, 'findOne').mockReturnValue({ select: selectMock } as any)

		await viewProfile(req, res, next)

		expect(selectMock).toHaveBeenCalledWith(expect.arrayContaining(['-email', '-phone', '+date_of_birth', '-loc_address', '-loc_postal_code']))
	})

	it('should not leak sensitive fields when viewing profile by path param', async () => {
		req.params.user_target = '507f1f77bcf86cd799439012'
		const user = {
			_id: '507f1f77bcf86cd799439012',
			first_name: 'John',
			in_relationship_with: '507f1f77bcf86cd799439099',
			email: 'private@example.com',
			phone: '+1234567890',
			loc_address: '123 Main St',
			loc_postal_code: '10001',
			date_of_birth: new Date('1990-01-01'),
		}
		const leanMock = vi.fn().mockResolvedValue(user)
		const populateMock = vi.fn().mockReturnValue({ lean: leanMock } as any)
		const selectMock = vi.fn().mockReturnValue({ populate: populateMock } as any)
		vi.spyOn(User, 'findOne').mockReturnValue({ select: selectMock } as any)

		await viewProfile(req, res, next)

		const payload = vi.mocked(res.json).mock.calls[0][0]
		expect(payload.success).toBe(true)
		expect(payload.data).not.toHaveProperty('email')
		expect(payload.data).not.toHaveProperty('phone')
		expect(payload.data).not.toHaveProperty('loc_address')
		expect(payload.data).not.toHaveProperty('loc_postal_code')
		expect(payload.data).not.toHaveProperty('date_of_birth')
		expect(payload.data).toHaveProperty('in_relationship_with', '507f1f77bcf86cd799439099')
		expect(payload.data).toHaveProperty('age', 33)
	})
})

describe('updateProfile', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		vi.mocked(User.findOne).mockReset()
		vi.mocked(User.findOneAndUpdate).mockReset()
		vi.mocked(User.exists).mockReset()
		vi.mocked(helper.syncInRelationshipWith).mockReset()
		vi.mocked(updateUserCoreQA).mockReset()
		vi.mocked(helper.getAgeFromDOB).mockReset()
		vi.mocked(helper.getAgeFromDOB).mockReturnValue(33)
		req = {
			body: {
				first_name: 'John',
				last_name: 'Doe',
				email: 'john@example.com',
				core_questions: ['Q1', 'Q2'],
				core_answers: ['A1', 'A2'],
			},
			requester: { _id: '69f8d15fc353a737a7cbaa5d' },
		}
		res = {
			status: vi.fn().mockReturnThis(),
			send: vi.fn(),
		}
		next = vi.fn()
		vi.mocked(updateUserCoreQA).mockImplementation(() => {})
	})

	it('should update user profile successfully', async () => {
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'Jane' }
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'John', last_name: 'Doe' }

		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		expect(User.findOne).toHaveBeenCalledWith({ _id: '69f8d15fc353a737a7cbaa5d' })
		expect(updateUserCoreQA).toHaveBeenCalledWith(existingUser, ['Q1', 'Q2'], ['A1', 'A2'])
		expect(User.findOneAndUpdate).toHaveBeenCalledWith(
			{ _id: '69f8d15fc353a737a7cbaa5d' },
			expect.objectContaining({
				first_name: 'John',
				last_name: 'Doe',
				email: 'john@example.com',
			}),
			{ new: true, runValidators: true },
		)
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.send).toHaveBeenCalledWith({ success: true, data: expect.objectContaining(updatedUser) })
		const updatePayload = vi.mocked(res.send).mock.calls[0][0]
		expect(updatePayload.data).toHaveProperty('age', 33)
		expect(next).not.toHaveBeenCalled()
	})

	it('should lowercase email when updating profile', async () => {
		req.body = {
			...req.body,
			email: 'John.DOE+Test@Example.COM',
		}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'Jane' }
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'John', last_name: 'Doe', email: 'john.doe+test@example.com' }

		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		expect(User.findOneAndUpdate).toHaveBeenCalledWith(
			{ _id: '69f8d15fc353a737a7cbaa5d' },
			expect.objectContaining({
				email: 'john.doe+test@example.com',
			}),
			{ new: true, runValidators: true },
		)
		expect(next).not.toHaveBeenCalled()
	})

	it('should update is_banned when provided', async () => {
		req.body = {
			is_banned: true,
		}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'Jane' }
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d', is_banned: true }

		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		expect(User.findOneAndUpdate).toHaveBeenCalledWith(
			{ _id: '69f8d15fc353a737a7cbaa5d' },
			expect.objectContaining({
				is_banned: true,
			}),
			{ new: true, runValidators: true },
		)
		expect(res.status).toHaveBeenCalledWith(200)
		expect(next).not.toHaveBeenCalled()
	})

	it('should set in_relationship_with and promote the relationship to exclusive/ongoing', async () => {
		req.body = {
			...req.body,
			in_relationship_with: '69f8d15fc353a737a7cbaa7f',
		}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'Jane', in_relationship_with: null }
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'John', in_relationship_with: '69f8d15fc353a737a7cbaa7f' }

		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		vi.spyOn(User, 'exists').mockResolvedValue({ _id: '69f8d15fc353a737a7cbaa7f' } as any)
		vi.mocked(helper.syncInRelationshipWith).mockResolvedValue(undefined)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		const [, updateDoc] = vi.mocked(User.findOneAndUpdate).mock.calls.at(-1) as any
		expect(updateDoc).toHaveProperty('in_relationship_with', '69f8d15fc353a737a7cbaa7f')
		expect(helper.syncInRelationshipWith).toHaveBeenCalledWith('69f8d15fc353a737a7cbaa5d', null, '69f8d15fc353a737a7cbaa7f')
		expect(next).not.toHaveBeenCalled()
	})

	it('should demote previous relationship to friends when in_relationship_with is unset', async () => {
		req.body = {
			...req.body,
			in_relationship_with: null,
		}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'Jane', in_relationship_with: '69f8d15fc353a737a7cbaa7f' }
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'John', in_relationship_with: null }

		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		vi.mocked(helper.syncInRelationshipWith).mockResolvedValue(undefined)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		expect(helper.syncInRelationshipWith).toHaveBeenCalledWith('69f8d15fc353a737a7cbaa5d', '69f8d15fc353a737a7cbaa7f', null)
		expect(next).not.toHaveBeenCalled()
	})

	it('should reject self reference in in_relationship_with', async () => {
		req.body = {
			...req.body,
			in_relationship_with: '69f8d15fc353a737a7cbaa5d',
		}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'Jane' }
		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)

		await updateProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('in_relationship_with cannot reference yourself', 'updateProfile'))
		expect(User.findOneAndUpdate).not.toHaveBeenCalled()
	})

	it('should handle missing requester ID', async () => {
		req.requester._id = undefined

		await updateProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('Not all required values were provided', 'updateProfile'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.send).not.toHaveBeenCalled()
	})

	it('should handle user not found', async () => {
		vi.spyOn(User, 'findOne').mockResolvedValue(null)

		await updateProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.notFound('User not found', 'updateProfile'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.send).not.toHaveBeenCalled()
	})

	it('should preserve existing date_of_birth when omitted in update payload', async () => {
		const existingDOB = new Date('1992-03-10')
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'Jane', date_of_birth: existingDOB }
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'John', date_of_birth: existingDOB }

		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		delete req.body.date_of_birth

		await updateProfile(req, res, next)
		const [, updateDoc] = vi.mocked(User.findOneAndUpdate).mock.calls.at(-1) as any

		expect(updateDoc).not.toHaveProperty('date_of_birth')
		expect(next).not.toHaveBeenCalled()
	})

	it('should reject invalid date_of_birth format', async () => {
		req.body = {
			date_of_birth: '2024-02-31',
		}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', core_questions: [], core_answers: [] }
		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)

		await updateProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(
			ApiError.badRequest(
				'date_of_birth must be a valid date (string date format or epoch timestamp), cannot be in the future, and cannot be more than 100 years ago',
				'updateProfile',
			),
		)
		expect(User.findOneAndUpdate).not.toHaveBeenCalled()
	})

	it('should reject future date_of_birth values', async () => {
		const tomorrow = new Date()
		tomorrow.setDate(tomorrow.getDate() + 1)
		const yyyy = tomorrow.getFullYear()
		const mm = String(tomorrow.getMonth() + 1).padStart(2, '0')
		const dd = String(tomorrow.getDate()).padStart(2, '0')

		req.body = {
			date_of_birth: `${yyyy}-${mm}-${dd}`,
		}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', core_questions: [], core_answers: [] }
		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)

		await updateProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(
			ApiError.badRequest(
				'date_of_birth must be a valid date (string date format or epoch timestamp), cannot be in the future, and cannot be more than 100 years ago',
				'updateProfile',
			),
		)
		expect(User.findOneAndUpdate).not.toHaveBeenCalled()
	})

	it('should reject date_of_birth values older than 100 years', async () => {
		const tooOld = new Date()
		tooOld.setFullYear(tooOld.getFullYear() - 101)
		const yyyy = tooOld.getFullYear()
		const mm = String(tooOld.getMonth() + 1).padStart(2, '0')
		const dd = String(tooOld.getDate()).padStart(2, '0')

		req.body = {
			date_of_birth: `${yyyy}-${mm}-${dd}`,
		}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', core_questions: [], core_answers: [] }
		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)

		await updateProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(
			ApiError.badRequest(
				'date_of_birth must be a valid date (string date format or epoch timestamp), cannot be in the future, and cannot be more than 100 years ago',
				'updateProfile',
			),
		)
		expect(User.findOneAndUpdate).not.toHaveBeenCalled()
	})

	it('should accept alternate date_of_birth string formats', async () => {
		req.body = {
			date_of_birth: 'March 10, 1992',
		}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', core_questions: [], core_answers: [] }
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d', date_of_birth: new Date('1992-03-10') }
		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		const [, updateDoc] = vi.mocked(User.findOneAndUpdate).mock.calls.at(-1) as any
		expect(updateDoc.date_of_birth).toBeInstanceOf(Date)
		expect(Number.isNaN(updateDoc.date_of_birth.getTime())).toBe(false)
		expect(next).not.toHaveBeenCalled()
	})

	it('should accept epoch timestamp for date_of_birth', async () => {
		req.body = {
			date_of_birth: 700272000,
		}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', core_questions: [], core_answers: [] }
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d', date_of_birth: new Date('1992-03-10') }
		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		const [, updateDoc] = vi.mocked(User.findOneAndUpdate).mock.calls.at(-1) as any
		expect(updateDoc.date_of_birth).toBeInstanceOf(Date)
		expect(Number.isNaN(updateDoc.date_of_birth.getTime())).toBe(false)
		expect(next).not.toHaveBeenCalled()
	})

	it('should not update omitted optional fields', async () => {
		const existingUser = {
			_id: '69f8d15fc353a737a7cbaa5d',
			first_name: 'Jane',
			last_name: 'Doe',
			education_school: 'State University',
			core_questions: ['Q1'],
			core_answers: ['A1'],
		}
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'John', last_name: 'Doe', education_school: 'State University' }

		req.body = { first_name: 'John', core_questions: ['Q1'], core_answers: ['A1'] }
		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		const [, updateDoc] = vi.mocked(User.findOneAndUpdate).mock.calls.at(-1) as any
		expect(updateDoc).toHaveProperty('first_name', 'John')
		expect(updateDoc).not.toHaveProperty('last_name')
		expect(updateDoc).not.toHaveProperty('education_school')
		expect(next).not.toHaveBeenCalled()
	})

	it('should update all profile fields', async () => {
		const fullProfileData = {
			first_name: 'John',
			last_name: 'Doe',
			username: 'johndoe',
			gender: 'male',
			genders_to_date: ['female'],
			is_test_user: false,
			email: 'john@example.com',
			phone: '+1234567890',
			have_kids: 'yes',
			want_kids: 'no',
			smoking: 'regularly',
			cannabis: 'never',
			relationship_structure: 'long_term_relationship',
			pets: true,
			faith_importance: 'high',
			location_radius: 50,
			vaccination_stance: 'pro_vaccination',
			deal_break_lightning: ['smoking'],
			loc_latitude: 40.7128,
			loc_longitude: -74.006,
			loc_address: '123 Main St',
			loc_city: 'New York',
			loc_state: 'NY',
			loc_country: 'US',
			loc_postal_code: '10001',
			drinking: 'never',
			political_view: 'moderate',
			about: 'About me',
			languages: ['English', 'Spanish'],
			date_of_birth: '1990-01-01',
			born_location: 'NYC',
			high_priority_values: ['honesty'],
			core_questions: ['Q1'],
			core_answers: ['A1'],
		}

		req.body = fullProfileData
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', core_questions: [], core_answers: [] }
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d', ...fullProfileData }

		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		expect(User.findOneAndUpdate).toHaveBeenCalledWith(
			{ _id: '69f8d15fc353a737a7cbaa5d' },
			expect.objectContaining({
				first_name: 'John',
				last_name: 'Doe',
				username: 'johndoe',
				gender: 'male',
				email: 'john@example.com',
				phone: '+1234567890',
				have_kids: 'yes',
				want_kids: 'no',
				smoking: 'regularly',
				cannabis: 'never',
				pets: true,
				drinking: 'never',
				political_view: 'moderate',
				about: 'About me',
				languages: ['English', 'Spanish'],
				date_of_birth: expect.any(Date),
				core_questions: existingUser.core_questions,
				core_answers: existingUser.core_answers,
			}),
			{ new: true, runValidators: true },
		)
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.send).toHaveBeenCalledWith({ success: true, data: expect.objectContaining(updatedUser) })
	})

	it('should convert imperial height values to centimeters', async () => {
		vi.mocked(helper.normalizeHeightToCentimeters).mockImplementation((value: unknown) => {
			if (value === 6) return 183
			if (value === 5) return 152
			return undefined
		})
		vi.mocked(helper.validatePreferences).mockReturnValue({
			height_min: 152,
			height_max: 183,
		} as any)

		req.body = {
			height: 6,
			preferences: {
				height_min: 5,
				height_max: 6,
			},
		}

		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', core_questions: [], core_answers: [] }
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d', height: 183 }

		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		expect(User.findOneAndUpdate).toHaveBeenCalledWith(
			{ _id: '69f8d15fc353a737a7cbaa5d' },
			expect.objectContaining({
				height: 183,
				preferences: expect.objectContaining({
					height_min: 152,
					height_max: 183,
				}),
			}),
			{ new: true, runValidators: true },
		)
		expect(next).not.toHaveBeenCalled()
	})

	it('should reject invalid weight_lbs outside allowed range', async () => {
		req.body = {
			weight_lbs: 20,
		}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', core_questions: [], core_answers: [] }
		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)

		await updateProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('weight_lbs must be a number between 50 and 700', 'updateProfile'))
		expect(User.findOneAndUpdate).not.toHaveBeenCalled()
	})

	it('should handle database errors', async () => {
		const dbError = new Error('Database connection failed')
		vi.spyOn(User, 'findOne').mockRejectedValue(dbError)

		await updateProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.internal('Database connection failed', 'updateProfile'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.send).not.toHaveBeenCalled()
	})

	it('should handle update operation failure', async () => {
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', first_name: 'Jane' }
		const updateError = new Error('Update failed')

		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		const selectMock = vi.fn().mockRejectedValue(updateError)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.internal('Update failed', 'updateProfile'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.send).not.toHaveBeenCalled()
	})

	it('should handle empty request body', async () => {
		req.body = {}
		const existingUser = { _id: '69f8d15fc353a737a7cbaa5d', core_questions: [], core_answers: [] }
		const updatedUser = { _id: '69f8d15fc353a737a7cbaa5d' }

		vi.spyOn(User, 'findOne').mockResolvedValue(existingUser)
		const selectMock = vi.fn().mockResolvedValue(updatedUser)
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		await updateProfile(req, res, next)

		expect(User.findOneAndUpdate).toHaveBeenCalledWith({ _id: '69f8d15fc353a737a7cbaa5d' }, {}, { new: true, runValidators: true })
		const [, updateDoc] = vi.mocked(User.findOneAndUpdate).mock.calls.at(-1) as any
		expect(updateDoc).not.toHaveProperty('core_questions')
		expect(updateDoc).not.toHaveProperty('core_answers')
		expect(updateDoc).not.toHaveProperty('first_name')
		expect(updateDoc).not.toHaveProperty('last_name')
		expect(updateDoc).not.toHaveProperty('email')
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.send).toHaveBeenCalledWith({ success: true, data: expect.objectContaining(updatedUser) })
	})
})

describe('createMomentImageOnly', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		vi.mocked(helper.isValidUserIdFormat).mockReturnValue(true)
		req = {
			query: {
				moment_id: 'meet123',
				user_target: '507f1f77bcf86cd799439013',
			},
			requester: { _id: '507f1f77bcf86cd799439014' },
		}
		res = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn().mockReturnThis(),
		}
		next = vi.fn()
		vi.mocked(helper.createMomentImage).mockResolvedValue({ url: 'image-url' } as any)
		vi.mocked(helper.createMomentImageWithOpenAIv2).mockResolvedValue({ url: 'image-url', dateMeetingPresignedUrl: 'meeting-img-filename' } as any)
		vi.mocked(aws.checkS3IfFileExists).mockResolvedValue(true as any)
		vi.mocked(helper.getMeetingDateImageFilename).mockReturnValue('meeting-img-filename')
		vi.mocked(momentUtils.trimPathOnly).mockImplementation((path: string) => path)
		vi.mocked(momentUtils.updateMeetWithImage).mockResolvedValue(false)
		vi.mocked(momentUtils.buildImageResponse).mockReturnValue({
			success: true,
			message: 'Dating meet image created successfully',
			data: {
				meeting_image: { url: 'image-url' } as any,
				moment: {
					_id: 'meet123' as any,
					user_a: '507f1f77bcf86cd799439014' as any,
					user_b: '507f1f77bcf86cd799439013' as any,
					summary: 'summary',
					summary_b: 'summary 2',
					tags: [],
					tone_score: '8',
					match_score: '9',
					when: new Date('2024-01-01T00:00:00Z'),
					user_a_image_url: 'user-a-url',
					user_b_image_url: 'user-b-url',
					image_urls: [],
				},
			},
		})
		vi.mocked(momentUtils.validateImageRequest).mockImplementation(() => {})
		vi.mocked(momentUtils.findMoment).mockResolvedValue({
			existingMeet: {
				_id: 'meet123',
				user_a: '507f1f77bcf86cd799439014',
				user_b: '507f1f77bcf86cd799439013',
				summary_a: 'summary',
				summary_b: 'summary 2',
				tags: [],
				tone_score: '8',
				match_score: '9',
				image_urls: [],
				when: new Date('2024-01-01T00:00:00Z'),
				save: vi.fn().mockResolvedValue({}),
			} as any,
			user_target: '507f1f77bcf86cd799439013',
		})
		vi.spyOn(User, 'findOne').mockResolvedValue({ _id: '507f1f77bcf86cd799439013' })
		vi.mocked(config).moment = { maxImagesPerMeeting: 3 }
	})

	it('should create dating moment image and respond with image data', async () => {
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue([{ _id: '507f1f77bcf86cd799439013', first_name: 'Target User' }]),
		} as any)
		vi.spyOn(Moment, 'findOne').mockResolvedValue({
			_id: 'meet123',
			user_a: '507f1f77bcf86cd799439014',
			user_b: '507f1f77bcf86cd799439013',
			summary_a: 'summary',
			summary_b: 'summary 2',
			tags: [],
			tone_score: '8',
			match_score: '9',
			image_urls: [],
			when: new Date('2024-01-01T00:00:00Z'),
			save: vi.fn().mockResolvedValue({}),
		} as any)

		await import('./controller').then(async ({ createMomentImageOnly }) => {
			await createMomentImageOnly(req, res, next)
		})

		expect(momentUtils.validateImageRequest).toHaveBeenCalledWith(req, '507f1f77bcf86cd799439013', 'meet123', undefined)
		expect(momentUtils.findMoment).toHaveBeenCalledWith('meet123', '507f1f77bcf86cd799439013', '507f1f77bcf86cd799439014')
		expect(vi.mocked(helper.createMomentImage).mock.calls.length + vi.mocked(helper.createMomentImageWithOpenAIv2).mock.calls.length).toBeGreaterThan(0)
		expect(momentUtils.updateMeetWithImage).toHaveBeenCalledWith(
			expect.objectContaining({
				_id: 'meet123',
				image_urls: [],
			}),
			'meeting-img-filename',
		)
		expect(momentUtils.buildImageResponse).toHaveBeenCalled()
		expect(res.status).toHaveBeenCalledWith(200)
		expect(next).not.toHaveBeenCalled()
	})

	it('should throw badRequest if max images reached', async () => {
		vi.mocked(momentUtils.findMoment).mockResolvedValue({
			existingMeet: {
				_id: 'meet123',
				user_a: '507f1f77bcf86cd799439014',
				user_b: '507f1f77bcf86cd799439013',
				summary_a: 'summary',
				summary_b: 'summary 2',
				image_urls: [1, 2, 3],
				when: new Date('2024-01-01T00:00:00Z'),
				save: vi.fn().mockResolvedValue({}),
			} as any,
			user_target: '507f1f77bcf86cd799439013',
		})
		await import('./controller').then(async ({ createMomentImageOnly }) => {
			await createMomentImageOnly(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.badRequest('Maximum number of images (3) for this dating meet has been reached', 'createMomentImageOnly'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})

	it('should throw notFound if user not found', async () => {
		vi.spyOn(User, 'findOne').mockResolvedValue(null)
		await import('./controller').then(async ({ createMomentImageOnly }) => {
			await createMomentImageOnly(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.notFound('User not found', 'createMomentImageOnly'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})

	it('should use default journal if summary_a and journal_a are missing', async () => {
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue([{ _id: '507f1f77bcf86cd799439013', first_name: 'Target User' }]),
		} as any)
		vi.spyOn(Moment, 'findOne').mockResolvedValue({
			_id: 'meet123',
			user_a: '507f1f77bcf86cd799439014',
			user_b: '507f1f77bcf86cd799439013',
			summary_a: null,
			summary_b: null,
			tags: [],
			tone_score: '8',
			match_score: '9',
			image_urls: [],
			when: new Date('2024-01-01T00:00:00Z'),
			save: vi.fn().mockResolvedValue({}),
		} as any)
		vi.mocked(momentUtils.findMoment).mockResolvedValue({
			existingMeet: {
				_id: 'meet123',
				user_a: '507f1f77bcf86cd799439014',
				user_b: '507f1f77bcf86cd799439013',
				summary_a: '',
				summary_b: '',
				tags: [],
				tone_score: '8',
				match_score: '9',
				image_urls: [],
				when: new Date('2024-01-01T00:00:00Z'),
				save: vi.fn().mockResolvedValue({}),
			} as any,
			user_target: '507f1f77bcf86cd799439013',
		})
		await import('./controller').then(async ({ createMomentImageOnly }) => {
			await createMomentImageOnly(req, res, next)
		})
		expect(vi.mocked(helper.createMomentImage).mock.calls.length + vi.mocked(helper.createMomentImageWithOpenAIv2).mock.calls.length).toBeGreaterThan(0)
		expect(momentUtils.buildImageResponse).toHaveBeenCalled()
		expect(next).not.toHaveBeenCalled()
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: true,
				message: 'Dating meet image created successfully',
				data: expect.objectContaining({
					meeting_image: { url: 'image-url' },
					moment: expect.objectContaining({
						_id: 'meet123',
						user_a: '507f1f77bcf86cd799439014',
						user_b: '507f1f77bcf86cd799439013',
						summary: 'summary',
						summary_b: 'summary 2',
						tags: [],
						tone_score: '8',
						match_score: '9',
						when: new Date('2024-01-01T00:00:00Z'),
						user_a_image_url: 'user-a-url',
						user_b_image_url: 'user-b-url',
						image_urls: [],
					}),
				}),
			}),
		)
	})

	it('should throw internal error if createMomentImage returns null', async () => {
		vi.mocked(helper.createMomentImage).mockResolvedValue(null)
		await import('./controller').then(async ({ createMomentImageOnly }) => {
			await createMomentImageOnly(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.internal('Failed to create dating meet image', 'createMomentImageOnly'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})

	it('should handle unexpected errors and call next with internal error', async () => {
		vi.mocked(momentUtils.validateDateRequest).mockImplementation(() => {
			throw new Error('Unexpected error')
		})
		vi.mocked(momentUtils.findMoment).mockRejectedValue(new Error('Unexpected error'))
		await import('./controller').then(async ({ createMomentImageOnly }) => {
			await createMomentImageOnly(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.internal('Unexpected error', 'createMomentImageOnly'))
		expect(res.json).not.toHaveBeenCalled()
	})
})

describe('recreateAvatar', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		req = {
			query: {},
			body: {},
			requester: { _id: '507f1f77bcf86cd799439014' },
		}
		res = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn().mockReturnThis(),
		}
		next = vi.fn()
		vi.mocked(helper.createAvatarImage).mockResolvedValue('https://avatar.example.com/new.jpg')
	})

	it('should recreate avatar from moment profile_image_media_id when available', async () => {
		req.query.moment_id = 'moment123'
		vi.spyOn(User, 'findOne').mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439014' }) } as any)
		vi.spyOn(Moment, 'findOne').mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'moment123', profile_image_media_id: 'media-from-moment' }) } as any)
		vi.spyOn(Media, 'findOne').mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'media-from-moment', user_id: '507f1f77bcf86cd799439014' }) } as any)
		vi.spyOn(User, 'findOneAndUpdate').mockResolvedValue({} as any)

		await recreateAvatar(req, res, next)

		expect(Moment.findOne).toHaveBeenCalledWith({
			_id: 'moment123',
			$or: [{ user_a: '507f1f77bcf86cd799439014' }, { user_b: '507f1f77bcf86cd799439014' }],
		})
		expect(Media.findOne).toHaveBeenCalledWith({ _id: 'media-from-moment', user_id: '507f1f77bcf86cd799439014' })
		expect(User.findOneAndUpdate).toHaveBeenCalledWith(
			{ _id: '507f1f77bcf86cd799439014' },
			{ profile_image_media_id: 'media-from-moment', avatar_generated_at: expect.any(Date) },
			{ new: true, runValidators: true },
		)
		expect(helper.createAvatarImage).toHaveBeenCalled()
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith({
			success: true,
			data: {
				profile_image_media_id: 'media-from-moment',
				presignedAvatarUrl: 'https://avatar.example.com/new.jpg',
				source: 'moment_profile_image_media_id',
			},
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('should fallback to any available image when moment media is missing', async () => {
		req.query.moment_id = 'moment123'
		vi.spyOn(User, 'findOne').mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439014' }) } as any)
		vi.spyOn(Moment, 'findOne').mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'moment123' }) } as any)
		const sortMock = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'fallback-media-id', user_id: '507f1f77bcf86cd799439014' }) } as any)
		vi.spyOn(Media, 'findOne').mockReturnValue({ sort: sortMock } as any)
		vi.spyOn(User, 'findOneAndUpdate').mockResolvedValue({} as any)

		await recreateAvatar(req, res, next)

		expect(Media.findOne).toHaveBeenCalledWith({ user_id: '507f1f77bcf86cd799439014', type: 'image' })
		expect(sortMock).toHaveBeenCalledWith({ train_avatar: -1, createdAt: -1 })
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith({
			success: true,
			data: {
				profile_image_media_id: 'fallback-media-id',
				presignedAvatarUrl: 'https://avatar.example.com/new.jpg',
				source: 'any_available_image',
			},
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('should return badRequest when no image is available', async () => {
		vi.spyOn(User, 'findOne').mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439014' }) } as any)
		const sortMock = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) } as any)
		vi.spyOn(Media, 'findOne').mockReturnValue({ sort: sortMock } as any)

		await recreateAvatar(req, res, next)

		expect(next).toHaveBeenCalledWith(ApiError.badRequest('No image available to generate avatar', 'recreateAvatar'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})
})

describe('deleteAccount', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		vi.clearAllMocks()
		req = { requester: { _id: '69f8d15fc353a737a7cbaa5d' } }
		res = {
			status: vi.fn().mockReturnThis(),
			send: vi.fn(),
		}
		next = vi.fn()
		vi.mocked(helper.getProfileImageFilename).mockReturnValue('profile-img-69f8d15fc353a737a7cbaa5d')
		vi.mocked(helper.getAvatarFilename).mockReturnValue('avatar-img-69f8d15fc353a737a7cbaa5d')
		vi.mocked(helper.getAvatarFilenameResolved).mockResolvedValue('avatar-img-69f8d15fc353a737a7cbaa5d')
		vi.mocked(helper.getMeetingDateImageFilename).mockImplementation((a: any, b: any, when: any) => `meeting-img-${a}-${b}-${when?.getTime()}`)
		vi.mocked(momentUtils.trimPathOnly).mockImplementation((path: string) => path)
		vi.mocked(aws.deleteFromS3).mockResolvedValue({})
		vi.spyOn(User, 'findOne').mockResolvedValue({ _id: '69f8d15fc353a737a7cbaa5d' })
		vi.spyOn(User, 'findOneAndDelete').mockResolvedValue({})
		vi.spyOn(Moment, 'find').mockResolvedValue([
			{
				_id: 'moment-1',
				user_a: '69f8d15fc353a737a7cbaa5d',
				user_b: 'user456',
				when: new Date('2024-01-01T00:00:00Z'),
				image_urls: ['meeting-img-69f8d15fc353a737a7cbaa5d-user456-1704067200000'],
			},
			{
				_id: 'moment-2',
				user_a: 'user456',
				user_b: '69f8d15fc353a737a7cbaa5d',
				when: new Date('2024-01-02T00:00:00Z'),
				image_urls: ['meeting-img-user456-69f8d15fc353a737a7cbaa5d-1704153600000'],
			},
		] as any)
		vi.spyOn(Moment, 'findOneAndDelete').mockResolvedValue({})
		vi.mocked(learningUtils.removeMomentIdsFromLearnings).mockResolvedValue(undefined)
		vi.spyOn(Learning, 'deleteMany').mockResolvedValue({} as any)
		vi.spyOn(Learning, 'updateMany').mockResolvedValue({} as any)
		vi.spyOn(Relationship, 'deleteMany').mockResolvedValue({} as any)
	})

	it('should delete account and related resources successfully', async () => {
		vi.spyOn(User, 'findOne').mockReturnValue({
			lean: vi.fn().mockReturnThis(),
			populate: vi.fn().mockResolvedValue({ _id: '69f8d15fc353a737a7cbaa5d' }),
		} as any)
		vi.spyOn(User, 'findOneAndDelete').mockResolvedValue({ _id: '69f8d15fc353a737a7cbaa5d' })
		vi.spyOn(Moment, 'findOne').mockResolvedValue({
			_id: 'meet123',
			user_a: 'user789',
			user_b: 'target456',
			summary_a: 'summary',
			summary_b: 'summary 2',
			tags: [],
			tone_score: '8',
			match_score: '9',
			image_urls: [],
			when: new Date('2024-01-01T00:00:00Z'),
			save: vi.fn().mockResolvedValue({}),
		} as any)
		vi.spyOn(Moment, 'deleteMany').mockResolvedValue({} as any)
		vi.spyOn(Media, 'deleteMany').mockResolvedValue({} as any)
		vi.spyOn(Media, 'find').mockResolvedValue([{ key: 'media-key-1' }, { key: 'media-key-2' }] as any)
		await import('./controller').then(async ({ deleteAccount }) => {
			await deleteAccount(req, res, next)
		})
		expect(User.findOne).toHaveBeenCalledWith({ _id: '69f8d15fc353a737a7cbaa5d' })
		expect(Moment.find).toHaveBeenCalledWith({ $or: [{ user_a: '69f8d15fc353a737a7cbaa5d' }, { user_b: '69f8d15fc353a737a7cbaa5d', private_to_a: false }] })
		expect(learningUtils.removeMomentIdsFromLearnings).toHaveBeenCalledWith(['moment-1', 'moment-2'], true)
		expect(Learning.deleteMany).toHaveBeenCalledWith({ $or: [{ user_id: '69f8d15fc353a737a7cbaa5d' }, { reference_user_ids: ['69f8d15fc353a737a7cbaa5d'] }] })
		expect(Learning.updateMany).toHaveBeenCalledWith({ reference_user_ids: { $in: ['69f8d15fc353a737a7cbaa5d'] } }, { $pull: { reference_user_ids: '69f8d15fc353a737a7cbaa5d' } })
		expect(aws.deleteFromS3).toHaveBeenCalledWith('profile-img-69f8d15fc353a737a7cbaa5d')
		expect(aws.deleteFromS3).toHaveBeenCalledWith('avatar-img-69f8d15fc353a737a7cbaa5d')
		expect(aws.deleteFromS3).toHaveBeenCalledWith('meeting-img-69f8d15fc353a737a7cbaa5d-user456-1704067200000')
		expect(aws.deleteFromS3).toHaveBeenCalledWith('meeting-img-user456-69f8d15fc353a737a7cbaa5d-1704153600000')
		expect(Relationship.deleteMany).toHaveBeenCalledWith({ $or: [{ user_a: '69f8d15fc353a737a7cbaa5d' }, { user_b: '69f8d15fc353a737a7cbaa5d' }] })
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.send).toHaveBeenCalledWith({ success: true, message: 'Account deleted successfully' })
		expect(next).not.toHaveBeenCalled()
	})

	it('should handle missing requester ID', async () => {
		req.requester._id = undefined
		await import('./controller').then(async ({ deleteAccount }) => {
			await deleteAccount(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.badRequest('Not all required values were provided', 'deleteAccount'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.send).not.toHaveBeenCalled()
	})

	it('should handle user not found', async () => {
		vi.spyOn(User, 'findOne').mockResolvedValue(null)
		await import('./controller').then(async ({ deleteAccount }) => {
			await deleteAccount(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.notFound('User not found', 'deleteAccount'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.send).not.toHaveBeenCalled()
	})

	it('should handle errors during deletion', async () => {
		vi.spyOn(User, 'findOne').mockRejectedValue(new Error('DB error'))
		await import('./controller').then(async ({ deleteAccount }) => {
			await deleteAccount(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.internal('DB error', 'deleteAccount'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.send).not.toHaveBeenCalled()
	})

	it('should handle errors during resource deletion', async () => {
		vi.spyOn(User, 'findOne').mockResolvedValue({ _id: '69f8d15fc353a737a7cbaa5d' })
		vi.spyOn(Moment, 'find').mockRejectedValue(new Error('Resource error'))
		await import('./controller').then(async ({ deleteAccount }) => {
			await deleteAccount(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.internal('Resource error', 'deleteAccount'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.send).not.toHaveBeenCalled()
	})
})

describe('deleteMoment', () => {
	let req: any
	let res: any
	let next: any
	let moment: any

	beforeEach(() => {
		vi.clearAllMocks()
		req = {
			params: { moment_id: 'meet123' },
			query: {},
			requester: { _id: 'userA', is_admin: false },
		}
		res = {
			status: vi.fn().mockReturnThis(),
			json: vi.fn().mockReturnThis(),
		}
		next = vi.fn()
		moment = {
			_id: 'meet123',
			user_a: 'userA',
			user_b: 'userB',
			when: new Date('2024-01-01T00:00:00Z'),
			soft_delete_user_a: null,
			soft_delete_user_b: null,
			save: vi.fn().mockResolvedValue({}),
		}
		vi.spyOn(Moment, 'findOne').mockResolvedValue(moment)
		vi.spyOn(Moment, 'deleteOne').mockResolvedValue({ acknowledged: true, deletedCount: 1 })
		vi.mocked(helper.getMeetingDateImageFilename).mockReturnValue('meeting-img-filename')
		vi.mocked(aws.deleteFromS3).mockResolvedValue({})
	})

	it('should call next with notFound if dating meet not found', async () => {
		vi.spyOn(Moment, 'findOne').mockResolvedValue(null)
		await import('../moment/controller').then(async ({ deleteMoment }) => {
			await deleteMoment(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.notFound('Dating meet not found', 'deleteMoment'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})

	it('should hard delete if hard_delete is true and requester is admin', async () => {
		req.query.hard_delete = 'true'
		req.requester.is_admin = true
		vi.spyOn(Moment, 'findOne').mockResolvedValue({
			_id: 'meet123',
			user_a: 'userA',
			user_b: 'userB',
			when: new Date('2024-01-01T00:00:00Z'),
			soft_delete_user_a: null,
			soft_delete_user_b: null,
		} as any)
		await import('../moment/controller').then(async ({ deleteMoment }) => {
			await deleteMoment(req, res, next)
		})
		expect(Moment.deleteOne).toHaveBeenCalledWith({ _id: 'meet123' })
		expect(aws.deleteFromS3).toHaveBeenCalledWith('meeting-img-filename')
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith({
			success: true,
			message: 'Moment permanently deleted successfully',
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('should call next with forbidden if hard_delete is true and requester is not admin', async () => {
		req.query.hard_delete = 'true'
		req.requester.is_admin = false
		await import('../moment/controller').then(async ({ deleteMoment }) => {
			await deleteMoment(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.forbidden('You do not have access to hard delete this dating meet', 'deleteMoment'))
		expect(Moment.deleteOne).not.toHaveBeenCalled()
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})

	it('should call next with forbidden if requester is not user_a or user_b', async () => {
		req.requester._id = 'otherUser'
		await import('../moment/controller').then(async ({ deleteMoment }) => {
			await deleteMoment(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.forbidden('You do not have access to delete this dating meet', 'deleteMoment'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})

	it('should call next with badRequest if already soft deleted by user_a', async () => {
		moment.soft_delete_user_a = new Date()
		req.requester._id = 'userA'
		await import('../moment/controller').then(async ({ deleteMoment }) => {
			await deleteMoment(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.badRequest('You have already deleted this dating meet', 'deleteMoment'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})

	it('should call next with badRequest if already soft deleted by user_b', async () => {
		moment.soft_delete_user_b = new Date()
		req.requester._id = 'userB'
		await import('../moment/controller').then(async ({ deleteMoment }) => {
			await deleteMoment(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.badRequest('You have already deleted this dating meet', 'deleteMoment'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})

	it('should soft delete for user_a and save', async () => {
		req.requester._id = 'userA'
		moment.soft_delete_user_a = null
		moment.soft_delete_user_b = null
		await import('../moment/controller').then(async ({ deleteMoment }) => {
			await deleteMoment(req, res, next)
		})
		expect(moment.save).toHaveBeenCalled()
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith({
			success: true,
			message: 'Moment deleted successfully',
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('should soft delete for user_b and save', async () => {
		req.requester._id = 'userB'
		moment.soft_delete_user_a = null
		moment.soft_delete_user_b = null
		await import('../moment/controller').then(async ({ deleteMoment }) => {
			await deleteMoment(req, res, next)
		})
		expect(moment.save).toHaveBeenCalled()
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith({
			success: true,
			message: 'Moment deleted successfully',
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('should hard delete if both users have soft deleted', async () => {
		moment.soft_delete_user_b = new Date()
		req.requester._id = 'userA'
		await import('../moment/controller').then(async ({ deleteMoment }) => {
			await deleteMoment(req, res, next)
		})
		expect(Moment.deleteOne).toHaveBeenCalledWith({ _id: 'meet123' })
		expect(aws.deleteFromS3).toHaveBeenCalledWith('meeting-img-filename')
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.json).toHaveBeenCalledWith({
			success: true,
			message: 'Moment permanently deleted successfully',
		})
		expect(next).not.toHaveBeenCalled()
	})

	it('should call next with internal error on exception', async () => {
		vi.spyOn(Moment, 'findOne').mockRejectedValue(ApiError.internal('DB error', 'deleteMoment'))
		await import('../moment/controller').then(async ({ deleteMoment }) => {
			await deleteMoment(req, res, next)
		})
		expect(next).toHaveBeenCalledWith(ApiError.internal('DB error', 'deleteMoment'))
		expect(res.status).not.toHaveBeenCalled()
		expect(res.json).not.toHaveBeenCalled()
	})
})
