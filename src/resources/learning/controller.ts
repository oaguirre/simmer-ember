import { type Req } from '../../utils/types'
import { isValidUserIdFormat } from '../../utils/user/helper'
import Learning, { LearningType } from './model'

export const createLearning = async (req: Req, res: any) => {
	try {
		const learning = new Learning({ ...(req.body as LearningType), user_id: req.requester._id })
		const savedLearning = await learning.save()
		res.status(201).json({
			success: true,
			data: savedLearning,
		})
	} catch (error) {
		res.status(400).json({ success: false, error: 'Failed to create learning', details: error })
	}
}

export const getLearnings = async (req: Req, res: any) => {
	try {
		const { limit, skip, user_target } = req.query
		if (user_target && !isValidUserIdFormat(user_target)) {
			return res.status(400).json({ success: false, error: 'Invalid user_target format' })
		}
		const learnings = user_target
			? await Learning.find({
					user_id: req.requester._id,
				})
					.sort({ updatedAt: -1 })
					.limit(Number(limit) || 5)
					.skip(Number(skip) || 0)
			: await Learning.find({
					user_id: req.requester._id,
					reference_user_ids: user_target,
				})
					.sort({ updatedAt: -1 })
					.limit(Number(limit) || 5)
					.skip(Number(skip) || 0)
		res.json({
			success: true,
			data: learnings,
		})
	} catch (error) {
		res.status(400).json({ success: false, error: 'Failed to retrieve learnings', details: error })
	}
}

export const getLearningById = async (req: Req, res: any) => {
	try {
		const learning = await Learning.findById(req.params.id)
		if (!learning) {
			return res.status(404).json({ success: false, error: 'Learning not found' })
		}
		res.json({
			success: true,
			data: learning,
		})
	} catch (error) {
		res.status(400).json({ error: 'Failed to retrieve learning', details: error })
	}
}

export const updateLearning = async (req: Req, res: any) => {
	try {
		const updatedLearning = await Learning.findByIdAndUpdate(req.params.id, req.body, { new: true })
		if (!updatedLearning) {
			return res.status(404).json({ success: false, error: 'Learning not found' })
		}
		if (String(updatedLearning.user_id) !== String(req.requester._id)) {
			return res.status(403).json({ success: false, error: 'You do not have permission to update this learning' })
		}
		res.json({
			success: true,
			data: updatedLearning,
		})
	} catch (error) {
		res.status(400).json({ error: 'Failed to update learning', details: error })
	}
}

export const deleteLearning = async (req: Req, res: any) => {
	try {
		const deletedLearning = await Learning.findByIdAndDelete(req.params.id)
		if (!deletedLearning) {
			return res.status(404).json({ success: false, error: 'Learning not found' })
		}
		if (String(deletedLearning.user_id) !== String(req.requester._id)) {
			return res.status(403).json({ success: false, error: 'You do not have permission to delete this learning' })
		}
		res.json({ success: true, message: 'Learning deleted successfully' })
	} catch (error) {
		res.status(400).json({ success: false, error: 'Failed to delete learning', details: error })
	}
}

export const addLearningEntry = async (req: Req, res: any) => {
	try {
		const { learningId } = req.params
		const { facts, preferences, avoidances, moment_ids, summary } = req.body
		const learning = await Learning.findById(learningId)
		if (!learning) {
			return res.status(404).json({ success: false, error: 'Learning not found' })
		}
		if (String(learning.user_id) !== String(req.requester._id)) {
			return res.status(403).json({ success: false, error: 'You do not have permission to update this learning' })
		}

		const updatedLearning = await Learning.findByIdAndUpdate(
			learningId,
			{
				user_id: req.requester._id,
				$addToSet: {
					facts: { $each: facts || [] },
					preferences: { $each: preferences || [] },
					avoidances: { $each: avoidances || [] },
					hypotheses: { $each: req.body.hypotheses || [] },
					insights: { $each: req.body.insights || [] },
					summary: summary || undefined,
					reference_user_ids: { $each: req.body.reference_user_ids || [] },
					moment_ids: { $each: moment_ids || [] },
				},
				summary,
			},
			{ new: true, runValidators: true },
		)

		if (!updatedLearning) {
			return res.status(404).json({ success: false, error: 'Learning not found' })
		}

		res.json({
			success: true,
			data: updatedLearning,
		})
	} catch (error) {
		res.status(400).json({ error: 'Failed to add learning entry', details: error })
	}
}

export const removeLearningEntry = async (req: Req, res: any) => {
	try {
		const { learningId } = req.params
		const { facts, preferences, avoidances, moment_ids } = req.body
		const learning = await Learning.findById(learningId)
		if (!learning) {
			return res.status(404).json({ success: false, error: 'Learning not found' })
		}
		if (String(learning.user_id) !== String(req.requester._id)) {
			return res.status(403).json({ success: false, error: 'You do not have permission to update this learning' })
		}

		const updatedLearning = await Learning.findByIdAndUpdate(
			learningId,
			{
				$pull: {
					facts: { $in: facts || [] },
					preferences: { $in: preferences || [] },
					avoidances: { $in: avoidances || [] },
					moment_ids: { $in: moment_ids || [] },
				},
			},
			{ new: true, runValidators: true },
		)

		if (!updatedLearning) {
			return res.status(404).json({ success: false, error: 'Learning not found' })
		}

		res.json({
			success: true,
			data: updatedLearning,
		})
	} catch (error) {
		res.status(400).json({ success: false, error: 'Failed to remove learning entry', details: error })
	}
}

export const getLearningsByMomentId = async (req: Req, res: any) => {
	try {
		const { limit, skip } = req.query
		const learnings = await Learning.find({ moment_ids: req.params.momentId, user_id: req.requester._id })
			.limit(Number(limit) || 5)
			.skip(Number(skip) || 0)
		res.json({
			success: true,
			data: learnings,
		})
	} catch (error) {
		res.status(400).json({ success: false, error: 'Failed to retrieve learnings', details: error })
	}
}
