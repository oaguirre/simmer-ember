import { MomentType } from '../../resources/moment/model'
import { Relationship } from '../../resources/relationship/model'
import { extractScore } from '../../resources/moment/controller'
import { UserType } from '../../resources/user/model'
import { RelationshipType } from '../../resources/relationship/model'
import { deduplicateSemanticTags } from '../formatting'
import { client as openAI } from '../../utils/openAI'
import { relationshipSummarizePrompts } from '../../resources/matches/relationshipPrompts'
import { logger } from '../logger'
import { safeJsonParse } from './helper'

const normalizeText = (value?: string | null): string => (value || '').trim().toLowerCase().replace(/\s+/g, ' ')

const normalizeDateMs = (value: unknown): number | null => {
	const ms = new Date(value as any).getTime()
	return Number.isFinite(ms) ? ms : null
}

const getIdString = (value: unknown): string => {
	if (!value) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'object') {
		const objectValue = value as any
		if (typeof objectValue.toHexString === 'function') return objectValue.toHexString()
		if (objectValue._id) return getIdString(objectValue._id)
	}
	return ''
}

const isSameMomentMemoryEntry = (memory: any, moment: MomentType, momentId: string): boolean => {
	if (momentId && getIdString(memory?.moment_id) === momentId) {
		return true
	}

	const memoryWhen = normalizeDateMs(memory?.when)
	const momentWhen = normalizeDateMs(moment.when)
	if (memoryWhen === null || momentWhen === null || memoryWhen !== momentWhen) {
		return false
	}

	return (
		normalizeText(memory?.title) === normalizeText(moment.title) &&
		normalizeText(memory?.summary_a) === normalizeText(moment.summary_a) &&
		normalizeText(memory?.summary_b) === normalizeText(moment.summary_b)
	)
}

export const getRelationshipStatus = async (userAId: string, userBId: string): Promise<string> => {
	const relationship = await Relationship.findOne({
		$or: [
			{ user_a: userAId, user_b: userBId },
			{ user_a: userBId, user_b: userAId },
		],
	})
	return relationship ? (relationship.status ?? 'not_found') : 'not_found'
}

export const updateRelationshipBasedOnDate = async (moment: MomentType) => {
	const { user_a, user_b, tone_score, match_score = '', key_moments } = moment
	const momentId = getIdString(moment._id)
	const relationship = await Relationship.findOne({
		$or: [
			{ user_a: user_a._id, user_b: user_b?._id },
			{ user_a: user_b?._id, user_b: user_a._id },
		],
	}).sort({
		createdAt: -1,
	})
	if (!relationship) {
		// If no relationship exists, create one with the date result
		await Relationship.create({
			user_a: user_a._id,
			user_b: user_b?._id,
			type: 'dating',
			status: 'initial',
			stage: 'matched',
			last_interaction: moment.when || new Date(),
			tags: deduplicateSemanticTags(moment.tags || []).slice(0, 100),
			notes: moment.final_why?.insight || '',
			avg_match_score: extractScore(match_score) || 0,
			tone_trend: tone_score,
			tone_score,
			short_term_memory: [
				{
					moment_id: moment._id,
					when: moment.when,
					title: moment.title,
					summary_a: moment.summary_a,
					summary_b: moment.summary_b,
					flags: moment.flags,
					tone_score,
					match_score,
					key_moments: deduplicateSemanticTags(key_moments || []).slice(0, 40),
					final_why: moment.final_why,
					createdAt: new Date(),
				},
			],
		})
	} else {
		// For short term memory, we will keep only the 3 most recent dates including the last one
		// Averaging scores and adding all flags and key moments
		// For long term memory, we will process all dates per year and summarize them
		// in single entry per year, which will be updated every time a new date happens in that year.
		// We will keep the most recent 5 years of long term memory and remove older ones.
		const shortTermMemory = relationship.short_term_memory || []
		const matchedMemoryIndex = shortTermMemory.findIndex(memory => isSameMomentMemoryEntry(memory, moment, momentId))
		const hasMomentAlready = matchedMemoryIndex >= 0
		const shortTermMemoryWithMomentId =
			hasMomentAlready && momentId
				? shortTermMemory.map((memory, idx) =>
						idx === matchedMemoryIndex && !getIdString(memory?.moment_id)
							? {
									...memory,
									moment_id: moment._id,
								}
							: memory,
					)
				: shortTermMemory
		const updatedShortTermMemory = (
			hasMomentAlready
				? [...shortTermMemoryWithMomentId]
				: [
						...shortTermMemoryWithMomentId,
						{
							moment_id: moment._id,
							when: moment.when,
							title: moment.title,
							summary_a: moment.summary_a,
							summary_b: moment.summary_b,
							flags: moment.flags,
							tone_score,
							match_score,
							key_moments: deduplicateSemanticTags(key_moments || []).slice(0, 40),
							final_why: moment.final_why,
							createdAt: new Date(),
							deletedAt: null,
						},
					]
		)
			.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
			.slice(0, 3)

		const allToneScores = updatedShortTermMemory.map(m => extractScore(m.tone_score || '')).filter(s => s !== undefined && s !== 0) as number[]
		const allMatchScores = updatedShortTermMemory.map(m => extractScore(m.match_score || '')).filter(s => s !== undefined && s !== 0) as number[]
		const avgToneScore = allToneScores.length > 0 ? allToneScores.reduce((a, b) => a + b, 0) / allToneScores.length : undefined
		const avgMatchScore = allMatchScores.length > 0 ? allMatchScores.reduce((a, b) => a + b, 0) / allMatchScores.length : undefined

		const longTermMemory = relationship.long_term_memory || []
		const updatedLongTermMemory = [...longTermMemory]
		const currentYear = new Date(moment.when || new Date()).getFullYear()
		const datesThisYear = updatedShortTermMemory.filter(m => new Date(m.when).getFullYear() === currentYear)
		if (datesThisYear.length > 0) {
			const summaryForTheYear = datesThisYear.map(m => `========\nDATE:\n${m.summary_a}`).join('\n')
			const existingEntryIndex = longTermMemory.findIndex(m => m.year === currentYear)
			if (existingEntryIndex >= 0) {
				const existingEntry = longTermMemory[existingEntryIndex]
				const existingFinalWhyObservations = existingEntry.final_why?.observations || []
				const existingFinalWhyInsights = existingEntry.final_why?.insights || []
				updatedLongTermMemory[existingEntryIndex] = {
					year: currentYear,
					summary: summaryForTheYear,
					tone_score:
						existingEntry.tone_score && avgToneScore
							? ((extractScore(existingEntry.tone_score) + avgToneScore) / 2).toString()
							: existingEntry.tone_score || (avgToneScore ? avgToneScore.toString() : '0'),
					avg_match_score:
						existingEntry.avg_match_score && avgMatchScore
							? ((parseFloat(existingEntry.avg_match_score) + avgMatchScore) / 2).toString()
							: existingEntry.avg_match_score || (avgMatchScore ? avgMatchScore.toString() : '0'),
					relevant_dates: datesThisYear.map(m => m.when),
					key_moments: deduplicateSemanticTags([...(existingEntry.key_moments || []), ...datesThisYear.reduce((acc, m) => [...acc, ...(m.key_moments || [])], [] as string[])]).slice(
						0,
						80,
					),
					final_why: {
						observations: deduplicateSemanticTags([...existingFinalWhyObservations, ...datesThisYear.reduce((acc, m) => [...acc, ...(m.final_why?.observations || [])], [] as string[])]),
						insights: deduplicateSemanticTags([...existingFinalWhyInsights, ...datesThisYear.reduce((acc, m) => [...acc, m.final_why?.insight || ''], [] as string[])]),
					},
					start_stage: existingEntry.start_stage,
					final_stage: relationship.stage === 'initial' ? (moment.summary_a?.includes('matched') ? 'matched' : relationship.stage) : (relationship.stage as any),
					start_status: existingEntry.start_status,
					final_status: relationship.status === 'initial' ? (moment.summary_a?.includes('matched') ? 'ongoing' : relationship.status) : (relationship.status as any),
				}
			} else {
				updatedLongTermMemory.push({
					year: currentYear,
					summary: summaryForTheYear,
					tone_score: avgToneScore ? avgToneScore.toString() : undefined,
					avg_match_score: avgMatchScore ? avgMatchScore.toString() : undefined,
					relevant_dates: datesThisYear.map(m => m.when),
					key_moments: deduplicateSemanticTags(datesThisYear.reduce((acc, m) => [...acc, ...(m.key_moments || [])], [] as string[])).slice(0, 80),
					final_why: {
						observations: deduplicateSemanticTags(datesThisYear.reduce((acc, m) => [...acc, ...(m.final_why?.observations || [])], [] as string[])),
						insights: deduplicateSemanticTags(datesThisYear.reduce((acc, m) => [...acc, m.final_why?.insight || ''], [] as string[])),
					},
					start_stage: relationship.stage,
					final_stage: relationship.stage,
					start_status: relationship.status,
					final_status: relationship.status,
				})
			}
		}

		const updated = await Relationship.findByIdAndUpdate(
			relationship._id,
			{
				last_interaction: moment.when || new Date(),
				tags: deduplicateSemanticTags([...(relationship.tags || []), ...(moment.tags || [])]).slice(0, 100),
				notes: moment.final_why?.insight || relationship.notes,
				avg_match_score: avgMatchScore || relationship.avg_match_score,
				tone_trend: avgToneScore || relationship.tone_trend,
				stage: relationship.stage === 'initial' ? 'matched' : relationship.stage,
				tone_score: moment.tone_score,
				short_term_memory: updatedShortTermMemory,
				long_term_memory: updatedLongTermMemory,
				deletedAt: null,
			},
			{ new: true, runValidators: true, returnDocument: 'after' },
		)

		if (updated) {
			const relationshipInput = await relationshipSummarizePrompts.v1.getRelationshipInput(updated, user_a as UserType, user_b as UserType)
			const relationshipInputStr = typeof relationshipInput === 'string' ? relationshipInput : JSON.stringify(relationshipInput)
			const userMessage = relationshipSummarizePrompts.v1.prompt.concat('\n\n-----\n\n', relationshipInputStr)
			const openAIResponse = await openAI?.responses.create({
				model: 'gpt-4.1',
				input: [{ role: 'user', content: [{ type: 'input_text', text: userMessage }] }],
			})
			if (openAIResponse) {
				const content = openAIResponse?.output.filter(output => output.type === 'message').map(output => (output as any).content as any[])
				const itemText = content?.[0].filter(item => item?.type === 'output_text').map(item => item.text)
				const digest = safeJsonParse<{ relationship_digest?: RelationshipType['digest'] }>(itemText?.[0] || '')
				if (!digest) {
					logger.warn('Failed to parse relationship digest from OpenAI output', { relationshipId: relationship._id })
				} else {
					logger.info('Digest received from OpenAI for relationship', { relationshipId: relationship._id, digest })
				}
				if (digest?.relationship_digest) {
					updated.digest = digest.relationship_digest
					await updated.save()
				}
			}
		}
		return updated
	}
}

export const createOrUpdateRelationshipsForPresentedDates = async (userA: UserType, userDates: UserType[]) => {
	const userIds = userDates.map(u => u._id)
	const existingRelationships = await Relationship.find({
		$or: [
			{ user_a: userA._id, user_b: { $in: userIds } },
			{ user_a: { $in: userIds }, user_b: userA._id },
		],
	})
	for (const userB of userDates) {
		const existingRelationship = existingRelationships.find(
			r => (String(r.user_a) === String(userA._id) && String(r.user_b) === String(userB._id)) || (String(r.user_a) === String(userB._id) && String(r.user_b) === String(userA._id)),
		)
		if (!existingRelationship) {
			await Relationship.create({
				user_a: userA._id,
				user_b: userB._id,
				type: 'dating',
				status: 'initial',
				stage: 'presented',
				last_interaction: new Date(),
				tags: ['presented_date'],
				notes: 'This relationship was created because a date between these users was presented in the last 30 days.',
				avg_match_score: 0,
				tone_trend: 'neutral',
				tone_score: 'neutral',
				short_term_memory: [],
				long_term_memory: [],
			})
		} else if (existingRelationship.stage === 'initial') {
			await Relationship.findByIdAndUpdate(
				existingRelationship._id,
				{
					stage: 'presented',
					last_interaction: new Date(),
					$addToSet: { tags: 'presented_date' },
					notes: existingRelationship.notes
						? existingRelationship.notes + '\n\nThis relationship was updated to "presented" stage because a date between these users was presented in the last 30 days.'
						: 'This relationship was updated to "presented" stage because a date between these users was presented in the last 30 days.',
					deletedAt: null,
				},
				{ new: true, runValidators: true },
			)
		} else if (existingRelationship.stage === 'presented') {
			await Relationship.findByIdAndUpdate(
				existingRelationship._id,
				{
					last_interaction: new Date(),
					deletedAt: null,
				},
				{ new: true, runValidators: true },
			)
		}
	}
}

export const mapRelationshipToResponse = (relationship: RelationshipType) => {
	return {
		id: relationship._id,
		user_a: relationship.user_a,
		user_b: relationship.user_b,
		type: relationship.type,
		status: relationship.status,
		stage: relationship.stage,
		anniversary_date: relationship.anniversary_date,
		last_interaction: relationship.last_interaction,
		tags: relationship.tags,
		horoscope_compatibility: relationship.horoscope_compatibility,
		shared_interests: relationship.shared_interests,
		next_action: relationship.next_action,
		next_steps: relationship.next_steps,
		notes: relationship.notes,
		avg_match_score: relationship.avg_match_score,
		tone_trend: relationship.tone_trend,
		short_term_memory: relationship.short_term_memory,
		long_term_memory: relationship.long_term_memory,
		...(relationship.deletedAt ? { deletedAt: relationship.deletedAt } : {}),
		updatedAt: relationship.updatedAt,
		createdAt: relationship.createdAt,
	}
}
