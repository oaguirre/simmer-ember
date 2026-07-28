import { MomentType } from '../../resources/moment/model'
import { LearningType } from '../../resources/learning/model'
import Learning from '../../resources/learning/model'
import { User } from '../../resources/user/model'
import { learningPrompts } from '../../resources/matches/learningPrompts'
import { client as openAI } from '../openAI'

export const getUserLearning = async (userId: string): Promise<LearningType | null> => {
	return await Learning.findOne({ user_id: userId })
}

export const addLearningEntry = async (userId: string, entry: Partial<LearningType>): Promise<LearningType> => {
	let learning = await Learning.findOne({ user_id: userId })
	if (!learning) {
		learning = new Learning({ user_id: userId })
	}
	if (entry.facts) {
		learning.facts = Array.from(new Set([...(learning.facts || []), ...entry.facts]))
	}
	if (entry.preferences) {
		learning.preferences = Array.from(new Set([...(learning.preferences || []), ...entry.preferences]))
	}
	if (entry.avoidances) {
		learning.avoidances = Array.from(new Set([...(learning.avoidances || []), ...entry.avoidances]))
	}
	if (entry.moment_ids) {
		learning.moment_ids = Array.from(new Set([...(learning.moment_ids || []), ...entry.moment_ids]))
	}
	if (entry.summary) {
		learning.summary = entry.summary
	}
	await learning.save()
	return learning
}

export const removeLearningEntry = async (userId: string, entry: Partial<LearningType>): Promise<LearningType | null> => {
	const learning = await Learning.findOne({ user_id: userId })
	if (!learning) {
		return null
	}
	if (entry.facts) {
		learning.facts = (learning.facts || []).filter(fact => !entry.facts?.includes(fact))
	}
	if (entry.preferences) {
		learning.preferences = (learning.preferences || []).filter(pref => !entry.preferences?.includes(pref))
	}
	if (entry.avoidances) {
		learning.avoidances = (learning.avoidances || []).filter(avoid => !entry.avoidances?.includes(avoid))
	}
	if (entry.moment_ids) {
		learning.moment_ids = (learning.moment_ids || []).filter(momentId => !entry.moment_ids?.includes(momentId))
	}
	await learning.save()
	return learning
}

export const getLearningsByUserId = async (userId: string): Promise<LearningType[]> => {
	return await Learning.find({ user_id: userId })
}

export const generateLearningsForMoment = async (moment: MomentType, learningUserId?: string): Promise<LearningType | null> => {
	const targetLearningUserId = String(learningUserId || moment.user_a || '')
	const momentUserAId = String(moment.user_a || '')
	const momentUserBId = moment.user_b ? String(moment.user_b) : ''
	const isPrivateToLearningUser = !!moment.private_to_a && targetLearningUserId === momentUserAId
	const isPrivateForOtherUser = !!moment.private_to_a && !!momentUserBId && targetLearningUserId === momentUserBId

	// A private_to_a moment should never be used to create learnings for user B.
	if (isPrivateForOtherUser) {
		return null
	}

	// Placeholder for actual insight generation logic, which could involve NLP techniques
	const learningPrompt = learningPrompts.v1
	const userA = await User.findById(targetLearningUserId).lean()
	const userB = moment.user_b ? await User.findById(moment.user_b).lean() : null
	if (!userA) return null
	const userMessage = learningPrompt.prompt.concat(`
    Input data:
    ${learningPrompt.getMomentInformation ? await learningPrompt.getMomentInformation(moment, userA, userB) : ''}
  `)
	const openAIResponse = await openAI?.responses.create({
		model: 'gpt-4.1',
		input: [{ role: 'user', content: [{ type: 'input_text', text: userMessage }] }],
	})
	const content = openAIResponse?.output.filter(output => output.type === 'message').map(output => (output as any).content as any[])
	const itemText = content?.[0].filter(item => item?.type === 'output_text').map(item => item.text)
	const reply = JSON.parse(itemText?.[0] || '')
	var learning: LearningType | null = null
	if (reply) {
		// If a learning already exists for this user and moment, we update it with the new information.
		// Otherwise, we create a new learning entry.
		learning = await Learning.findOne({ user_id: targetLearningUserId, moment_ids: moment._id })
		if (learning) {
			learning.private_to_user = !!learning.private_to_user || isPrivateToLearningUser
			learning.reference_user_ids = Array.from(
				new Set([...(learning.reference_user_ids?.map(id => id.toString()) || []), ...(moment.user_b ? [moment.user_b.toString()] : [])]),
			) as string[]
			learning.summary = reply.summary || learning.summary
			learning.insights = Array.from(new Set([...(learning.insights || []), ...(reply.insights || [])]))
			learning.facts = Array.from(new Set([...(learning.facts || []), ...(reply.facts || [])]))
			learning.preferences = Array.from(new Set([...(learning.preferences || []), ...(reply.preferences || [])]))
			learning.avoidances = Array.from(new Set([...(learning.avoidances || []), ...(reply.avoidances || [])]))
			learning.hypotheses = Array.from(new Set([...(learning.hypotheses || []), ...(reply.hypotheses || [])]))
			if (!learning.moment_ids?.includes(moment?._id || '')) {
				learning.moment_ids = Array.from(new Set([...(learning.moment_ids?.map(id => id.toString()) || []), ...(moment?._id ? [moment._id.toString()] : [])])) as string[]
			}
			await learning.save()
		} else {
			learning = await Learning.create({
				user_id: targetLearningUserId,
				private_to_user: isPrivateToLearningUser,
				moment_ids: [moment._id],
				insights: [reply.insights || []].flat(),
				facts: [reply.facts || []].flat(),
				preferences: [reply.preferences || []].flat(),
				avoidances: [reply.avoidances || []].flat(),
				hypotheses: [reply.hypotheses || []].flat(),
				summary: reply.summary || '',
				reference_user_ids: moment.user_b ? [moment.user_b.toString()] : [],
			})
		}
	}
	return learning
}

export const removeMomentIdsFromLearnings = async (momentIds: string[], deleteLearningIfNoMomentIdsLeft = false): Promise<void> => {
	const learnings = await Learning.find({ moment_ids: { $in: momentIds } })
	for (const learning of learnings) {
		learning.moment_ids = learning.moment_ids?.filter(id => !momentIds.includes(String(id))) || []
		if (deleteLearningIfNoMomentIdsLeft && learning.moment_ids.length === 0) {
			await Learning.deleteOne({ _id: learning._id })
		} else {
			await learning.save()
		}
	}
}
