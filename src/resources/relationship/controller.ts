import { ApiError, FormDataReq } from '../../utils'
import { Relationship, RelationshipType } from './model'
import { User } from '../user/model'
import { mapRelationshipToResponse } from '../../utils/user/relationship'
import mongoose from 'mongoose'
import { generateS3GetPresignedUrl } from '../../utils/aws'
import { getAvatarFilenameResolved, isValidUserIdFormat } from '../../utils/user/helper'
import { privateDecrypt } from 'node:crypto'

export const updateRelationship = async (req: FormDataReq, res: any, next: any) => {
	try {
		const { id } = req.params
		const { user_target } = req.query
		const { stage, status, anniversary_date } = req.body as {
			stage?: RelationshipType['stage']
			status?: RelationshipType['status']
			anniversary_date?: string | null
		}
		if (!id && !user_target) {
			next(ApiError.badRequest('Relationship ID or user_target query parameter must be provided', 'updateRelationship'))
			return
		}
		if (!stage && !status && anniversary_date === undefined) {
			next(ApiError.badRequest('At least one of stage, status, or anniversary_date must be provided', 'updateRelationship'))
			return
		}
		if (user_target && !isValidUserIdFormat(user_target)) {
			next(ApiError.badRequest('Invalid user_target format', 'updateRelationship'))
			return
		}
		var relationship = id
			? await Relationship.findOne({ _id: id })
			: await Relationship.findOne({
					$or: [
						{ user_a: req.requester?._id, user_b: user_target },
						{ user_a: user_target, user_b: req.requester?._id },
					],
				})
		if (!relationship && user_target) {
			relationship = new Relationship({
				user_a: req.requester?._id,
				user_b: user_target,
				stage: stage || 'initial',
				status: status || 'initial',
			})
		}
		if (!relationship) {
			next(ApiError.notFound('Relationship not found', 'updateRelationship'))
			return
		}
		if (String(relationship.user_a) !== String(req.requester?._id) && String(relationship.user_b) !== String(req.requester?._id)) {
			next(ApiError.badRequest('You do not have permission to update this relationship', 'updateRelationship'))
			return
		}

		if (stage) relationship.stage = stage
		if (status) relationship.status = status
		if (anniversary_date !== undefined) {
			if (anniversary_date === null || anniversary_date === '') {
				relationship.anniversary_date = undefined
			} else {
				const parsedDate = new Date(anniversary_date)
				if (Number.isNaN(parsedDate.getTime())) {
					next(ApiError.badRequest('anniversary_date must be a valid date', 'updateRelationship'))
					return
				}
				relationship.anniversary_date = parsedDate
			}
		}
		await relationship.save()

		return res.status(200).send({
			success: true,
			data: mapRelationshipToResponse(relationship),
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'updateRelationship'))
	}
}

export const deleteRelationship = async (req: FormDataReq, res: any, next: any) => {
	try {
		const { id } = req.params
		const { user_target, force_delete = false } = req.query
		if (!id && !user_target) {
			next(ApiError.badRequest('Relationship ID or user_target query parameter must be provided', 'deleteRelationship'))
			return
		}
		if (force_delete && !req.requester?.is_admin) {
			next(ApiError.badRequest('Only admins can force delete relationships', 'deleteRelationship'))
			return
		}
		const relationship = id
			? await Relationship.findOne({ _id: id })
			: await Relationship.findOne({
					$or: [
						{ user_a: req.requester?._id, user_b: user_target },
						{ user_a: user_target, user_b: req.requester?._id },
					],
				})
		if (!relationship) {
			next(ApiError.notFound('Relationship not found', 'deleteRelationship'))
			return
		}
		if (String(relationship.user_a) !== String(req.requester?._id) && String(relationship.user_b) !== String(req.requester?._id)) {
			next(ApiError.badRequest('You do not have permission to delete this relationship', 'deleteRelationship'))
			return
		}
		if (force_delete) {
			await relationship.deleteOne()
		} else {
			relationship.deletedAt = new Date()
			await relationship.save()
		}

		return res.status(200).send({
			success: true,
			message: 'Relationship deleted successfully',
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'deleteRelationship'))
	}
}

export const getRelationship = async (req: FormDataReq, res: any, next: any) => {
	try {
		const { id } = req.params
		const { user_target } = req.query
		if (!id && !user_target) {
			next(ApiError.badRequest('Relationship ID or user_target query parameter must be provided', 'getRelationship'))
			return
		}
		if (user_target && !isValidUserIdFormat(user_target)) {
			next(ApiError.badRequest('user_target ID has a wrong format', 'getRelationship'))
			return
		}
		const relationship = id
			? await Relationship.findOne({ _id: id })
			: await Relationship.findOne({
					$or: [
						{ user_a: req.requester?._id, user_b: user_target },
						{ user_a: user_target, user_b: req.requester?._id },
					],
					$and: [{ $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] }],
				})

		if (!relationship) {
			next(ApiError.notFound('Relationship not found', 'getRelationship'))
			return
		}
		if (String(relationship.user_a) !== String(req.requester?._id) && String(relationship.user_b) !== String(req.requester?._id)) {
			next(ApiError.badRequest('You do not have permission to view this relationship', 'getRelationship'))
			return
		}

		return res.status(200).send({
			success: true,
			data: mapRelationshipToResponse(relationship),
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'getRelationship'))
	}
}

export const getRelationships = async (req: FormDataReq, res: any, next: any) => {
	try {
		const { user_target, limit = 10, skip = 0 } = req.query
		if (user_target) {
			if (!isValidUserIdFormat(user_target)) {
				next(ApiError.badRequest('user_target ID has a wrong format', 'listRelationships'))
				return
			}
			const user = await User.findOne({ _id: user_target })
			if (!user) {
				next(ApiError.notFound('User not found', 'listRelationships'))
				return
			}
		}
		const relationships = user_target
			? await Relationship.find({
					$or: [
						{ user_a: user_target, user_b: req.requester?._id },
						{ user_a: req.requester?._id, user_b: user_target },
					],
					$and: [{ $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] }],
				})
					.sort({ updatedAt: -1 })
					.limit(limit || 10)
					.skip(skip)
			: await Relationship.find({
					$and: [{ $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] }],
					$or: [{ user_a: req.requester?._id }, { user_b: req.requester?._id }],
				})
					.sort({ updatedAt: -1 })
					.limit(limit || 10)
					.skip(skip)

		return res.status(200).send({
			success: true,
			data: relationships.map(relationship => mapRelationshipToResponse(relationship)),
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'listRelationships'))
	}
}

// Endpoint to list all counts of the number of Moments per Relationship
// Moments are linked through user_a and user_b but can be reversed
// Count all moments execpt those with type: 'coaching'
// Respond: Array<{
//   _id: relationship_id
//   count: number
//   user: {
//     _id: user_id
//     first_name: string
//     presignedAvatarUrl: string
//   }
// >}
// Allows user_target as a query parameter to filter only one relationship. If user_target not provided, list all relationships grouped by the other person
// Allow optional moments types as filter for counting
// Allow limit,skip
export const getMomentsCountPerRelationship = async (req: FormDataReq, res: any, next: any) => {
	try {
		const { user_target, types = [] } = req.query
		const limit = parseInt(req.query.limit as string) || 10
		const skip = parseInt(req.query.skip as string) || 0
		if (user_target) {
			if (!isValidUserIdFormat(user_target)) {
				next(ApiError.badRequest('user_target ID has a wrong format', 'listRelationships'))
				return
			}
			const user = await User.findOne({ _id: user_target })
			if (!user) {
				next(ApiError.notFound('User not found', 'listRelationships'))
				return
			}
		}
		const requesterId = new mongoose.Types.ObjectId(req.requester?._id)
		const momentTypeFilter = types && Array.isArray(types) && types.length > 0 ? { type: { $in: types } } : { type: { $ne: 'coaching' } }
		const match: any = {
			// deletedAt does not exist or is null
			$and: [
				{
					$or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
				},
			],
		}
		if (user_target) {
			match.$or = [
				{ user_a: user_target, user_b: req.requester?._id, private_to_a: false },
				{ user_a: req.requester?._id, user_b: user_target },
			]
		} else {
			match.$or = [{ user_a: req.requester?._id }, { user_b: req.requester?._id, private_to_a: false }]
		}
		const relationships = await Relationship.aggregate([
			{
				$match: match,
			},
			{
				$lookup: {
					from: 'moments',
					let: { rel_user_a: '$user_a', rel_user_b: '$user_b' },
					pipeline: [
						{
							$match: {
								...momentTypeFilter,
								$expr: {
									$or: [
										{ $and: [{ $eq: ['$user_a', '$$rel_user_a'] }, { $eq: ['$user_b', '$$rel_user_b'] }] },
										{ $and: [{ $eq: ['$user_a', '$$rel_user_b'] }, { $eq: ['$user_b', '$$rel_user_a'] }, { $eq: ['$private_to_a', false] }] },
									],
								},
							},
						},
					],
					as: 'moments',
				},
			},
			{
				$project: {
					_id: 1,
					user_a: 1,
					user_b: 1,
					status: 1,
					stage: 1,
					anniversary_date: 1,
					count: { $size: '$moments' },
					user: {
						$cond: {
							if: { $eq: ['$user_a', requesterId] },
							then: '$user_b',
							else: '$user_a',
						},
					},
				},
			},
			{
				$lookup: {
					from: 'users',
					localField: 'user',
					foreignField: '_id',
					as: 'user_data',
				},
			},
			{
				$unwind: '$user_data',
			},
			{
				$project: {
					_id: 1,
					user_a: '$user_a',
					user_b: '$user_b',
					status: '$status',
					stage: '$stage',
					anniversary_date: '$anniversary_date',
					count: 1,
					user: {
						_id: '$user_data._id',
						first_name: '$user_data.first_name',
					},
				},
			},
			{
				$sort: { count: -1 },
			},
			{
				$skip: skip,
			},
			{
				$limit: limit,
			},
		])
		const rowsWithAvatar = await Promise.all(
			relationships.map(async r => ({
				...r,
				user: {
					_id: r.user?._id,
					first_name: r.user?.first_name,
					presignedAvatarUrl: generateS3GetPresignedUrl(await getAvatarFilenameResolved(String(r.user?._id || ''))),
				},
			})),
		)

		return res.status(200).send({
			success: true,
			data: rowsWithAvatar,
		})
	} catch (error) {
		next(ApiError.internal(String(error), 'getMomentsCountPerRelationship'))
	}
}
