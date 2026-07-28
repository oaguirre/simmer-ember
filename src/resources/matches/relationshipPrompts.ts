import { LeanDocument } from 'mongoose'
import { RelationshipType } from '../relationship/model'
import { User, UserType } from '../user/model'
import Learning from '../learning/model'
import { getApproxLocation, getUserCoreQAPairs, getUserDatesCount, getUserPriorDates, stripEmptyFields } from './prompts'
import { deduplicateSemanticTags } from '../../utils/formatting'
import { extractScore } from '../moment/controller'

const getUserId = (user: Partial<UserType> | null | undefined): string => {
	if (!user?._id) {
		return ''
	}
	return String(user._id)
}

const hasPromptProfileSignal = (user: Partial<UserType> | null | undefined): boolean => {
	if (!user) {
		return false
	}
	const qaPairs = getUserCoreQAPairs(user as UserType)
	return Boolean(
		user.first_name ||
			user.username ||
			user.about ||
			user.gender ||
			user.loc_city ||
			user.loc_state ||
			user.loc_country ||
			(Array.isArray(user.languages) && user.languages.length > 0) ||
			(Array.isArray(user.high_priority_values) && user.high_priority_values.length > 0) ||
			qaPairs.length > 0,
	)
}

const resolvePromptUser = async (candidate: Partial<UserType> | null | undefined, relationshipUserRef: unknown): Promise<UserType | null> => {
	const fallbackUser = candidate ? null : typeof relationshipUserRef === 'string' ? await User.findById(relationshipUserRef) : (relationshipUserRef as UserType | null)
	const resolved = (candidate || fallbackUser) as UserType | null
	if (!resolved) {
		return null
	}

	if (hasPromptProfileSignal(resolved)) {
		return resolved
	}

	const userId = getUserId(resolved)
	if (!userId) {
		return resolved
	}

	const hydratedUser = await User.findById(userId)
	return (hydratedUser as UserType | null) || resolved
}

export const relationshipSummarizePrompts = {
	v1: {
		prompt: `You are a relationship-state compression engine for a simulated dating app.
Convert the raw relationship_state into a compact relationship_digest that will be passed into the next date simulation.
This is not a user-facing recap. Your job is to preserve only the relationship history that should affect the next simulated interaction.
Use only facts explicitly present in the input.
Do not invent dates, intimacy, attraction, conflict, private conversations, or backstory.
Deduplicate repeated ideas.
Ignore vague, placeholder, or low-information entries.
Prefer specific observable moments over generic labels.
Keep the digest compact, behavior-focused, and useful for scene generation.

Focus on:
• how familiar or warm the dynamic should feel
• recurring strengths
• recurring limitations or unresolved questions
• specific callbacks that may be reused
• greeting, pacing, repair, or humor habits
• what the next scene should test
• what the next scene should avoid over-assuming

Return only valid JSON in this exact shape:
  {
    "relationship_digest": {
      "history_level": "none|thin|moderate|established",
      "temperature": "warming|steady_warm|mixed|cooling|cautious|unclear",
      "core_dynamic": "one sentence describing the central relationship pattern",
      "strengths": [
        "short behavioral strength",
        "short behavioral strength",
        "short behavioral strength"
      ],
      "limitations": [
        "short behavioral limitation, dependency, risk, or unresolved question",
        "short behavioral limitation, dependency, risk, or unresolved question"
      ],
      "callbacks_allowed": [
        "specific prior moment or phrase that may be referenced",
        "specific prior moment or phrase that may be referenced"
      ],
      "behavioral_continuity": [
        "specific observable habit, greeting pattern, pacing pattern, repair habit, or recurring gesture",
        "specific observable habit, greeting pattern, pacing pattern, repair habit, or recurring gesture"
      ],
      "next_scene_should_test": "one sentence describing what the next simulation should reveal",
      "next_scene_should_avoid": "one sentence describing what the next simulation should not over-assume or flatten"
    }
  }

Keep the output concise:
• core_dynamic should be 1 sentence
• strengths should contain 2–4 items
• limitations should contain 1–3 items
• callbacks_allowed should contain 3–8 items
• behavioral_continuity should contain 2–4 items
• next_scene_should_test and next_scene_should_avoid should each be 1 sentence

If relationship_state contains a total_dates count:
• 0–1 usable dates = "thin"
• 2–4 usable dates = "moderate"
• 5+ usable dates = "established"

If relationship_state contains many entries but most are vague, placeholder, or low-information, lower the history_level accordingly.
If prior scores, flags, repeated themes, or limitations suggest caution, preserve that caveat. Do not let warm history become uniformly high compatibility.

INPUT:
  `,
		getRelationshipInput: async (relationship: LeanDocument<RelationshipType>, user_a: UserType | undefined, user_b: UserType | undefined) => {
			const user1 = (await resolvePromptUser(user_a as Partial<UserType> | undefined, relationship.user_a)) as UserType | null as any
			const user2 = (await resolvePromptUser(user_b as Partial<UserType> | undefined, relationship.user_b)) as UserType | null as any
			if (!user1 || !user2) {
				return {}
			}
			const keySharedMoments: string[] = []
			const ongoingThemes: string[] = []
			const allFlags: { green: string[]; yellow: string[]; red: string[] } = {
				green: [],
				yellow: [],
				red: [],
			}
			const countDates = await getUserDatesCount(String(user1._id), String(user2._id))
			const priorDates = (await getUserPriorDates(user1 as UserType, user2 as UserType)).map(date => {
				const { key_moments, items, flags, tags } = date
				if (key_moments && key_moments.length > 0) {
					keySharedMoments.push(...key_moments)
				} else if (tags?.length) {
					keySharedMoments.push(...tags)
				}
				if (items && items.length > 0) {
					ongoingThemes.push(...(items || []))
				}
				if (flags?.green && flags.green.length > 0) {
					allFlags.green.push(...flags.green)
				}
				if (flags?.yellow && flags.yellow.length > 0) {
					allFlags.yellow.push(...flags.yellow)
				}
				if (flags?.red && flags.red.length > 0) {
					allFlags.red.push(...flags.red)
				}
				return date
			})
			const learnings = await Learning.find({
				$or: [
					{
						user_id: String(user1._id),
						reference_user_ids: { $in: [String(user2._id)] },
					},
					{
						user_id: String(user2._id),
						reference_user_ids: { $in: [String(user1._id)] },
					},
					{
						user_id: String(user1._id),
						// empty or null
						reference_user_ids: { $in: [[], null] },
					},
					{
						user_id: String(user2._id),
						// empty or null
						reference_user_ids: { $in: [[], null] },
					},
				],
			})
				.sort({
					createdAt: -1,
				})
				.limit(20)
				.lean()

			var relationshipState: any = null
			if (countDates > 0) {
				const toneTrend = 'steady_warm'
				const avgMatchScore = priorDates.reduce((acc, date) => acc + (extractScore(date.match_score || '') || 0), 0) / priorDates.length
				const lastDate = priorDates[0]
				const dedupedKeySharedMoments = deduplicateSemanticTags(keySharedMoments).slice(0, 15)
				const dedupedOngoingThemes = deduplicateSemanticTags(ongoingThemes).slice(0, 10)
				const dedupedFlags = {
					green: deduplicateSemanticTags(allFlags.green).slice(0, 5),
					yellow: deduplicateSemanticTags(allFlags.yellow).slice(0, 5),
					red: deduplicateSemanticTags(allFlags.red).slice(0, 5),
				}
				relationshipState = {
					type: relationship?.type || null,
					state: relationship?.status || null,
					stage: relationship?.stage || null,
					last_interaction: relationship?.last_interaction || null,
					tags: deduplicateSemanticTags(relationship?.tags || []).slice(0, 20),
					total_dates: countDates,
					key_shared_moments: dedupedKeySharedMoments,
					tone_trend: toneTrend,
					avg_match_score: Math.round(avgMatchScore),
					anniversary_date: relationship?.anniversary_date || null,
					last_date: {
						location: lastDate.location,
						tone: lastDate.tone_score,
						opening_line: lastDate.opening_line,
						ending_note: lastDate.ending_note,
						key_shared_moments: lastDate.key_moments || [],
					},
					ongoing_themes: dedupedOngoingThemes,
					flags: dedupedFlags,
					prior_dates: priorDates.slice(0, 5).map(date => ({
						location: date.location,
						items: date.items,
						mood: date.mood,
						summary: date.summary_a,
						when: date.when,
						tone: date.tone_score,
						opening_line: date.opening_line,
						ending_note: date.ending_note,
						key_moments: date.key_moments?.length ? date.key_moments : date.tags || [],
					})),
					learnings: learnings.filter(learning => learning.reference_user_ids?.length).map(learning => learning.summary) || [],
				}
			}

			const isAnswered = (v: any) =>
				v != null && String(v).trim().toLowerCase() !== 'n/a' && String(v).trim().toLowerCase() !== 'unanswered' && String(v).trim().toLowerCase() !== 'prefer_not_to_say'
			const filteredQA = (user: UserType) => {
				const qs: string[] = [],
					as: string[] = []
				getUserCoreQAPairs(user).forEach(({ question, answer }) => {
					if (isAnswered(answer)) {
						qs.push(question)
						as.push(answer)
					}
				})
				return { questions: qs, answers: as }
			}
			const u1qa = filteredQA(user1)
			const u2qa = filteredQA(user2)

			const user1Learnings =
				learnings
					.filter(learning => learning.user_id === String(user1._id) && (!learning.reference_user_ids || learning.reference_user_ids.length === 0))
					.map(learning => learning.summary) || []

			const user2Learnings =
				learnings
					.filter(learning => learning.user_id === String(user2._id) && (!learning.reference_user_ids || learning.reference_user_ids.length === 0))
					.map(learning => learning.summary) || []

			const buildPromptProfile = (user: UserType, qa: { questions: string[]; answers: string[] }, userLearnings: Array<string | undefined>) => {
				const normalizedLearnings = userLearnings.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
				const profile = stripEmptyFields({
					first_name: user.first_name,
					age: user.date_of_birth ? new Date().getFullYear() - new Date(user.date_of_birth).getFullYear() : null,
					gender: user.gender,
					location: getApproxLocation(user),
					questions_answers: qa.questions.map((question, index) => ({ question, answer: qa.answers[index] })),
					high_priority_values: user.high_priority_values,
					have_kids: user.have_kids,
					want_kids: user.want_kids,
					height: user.height,
					drinking: user.drinking,
					smoking: user.smoking,
					cannabis: user.cannabis,
					relationship_structure: user.relationship_structure,
					pets: user.pets,
					have_pets: user.have_pets,
					faith_importance: user.faith_importance,
					vaccination_stance: user.vaccination_stance,
					political_view: user.political_view,
					exercise: user.exercise,
					education: user.education,
					job: user.job,
					religion: user.religion,
					activities: user.activities,
					culture: user.culture,
					languages: user.languages,
					bio: user.about,
					learnings: normalizedLearnings,
				})

				if (Object.keys(profile).length > 0) {
					return profile
				}

				return {
					first_name: user.first_name || user.username || 'Unknown',
					location: getApproxLocation(user),
					questions_answers: qa.questions.map((question, index) => ({ question, answer: qa.answers[index] })),
					learnings: normalizedLearnings,
				}
			}

			return {
				A: buildPromptProfile(user1, u1qa, user1Learnings),
				B: buildPromptProfile(user2, u2qa, user2Learnings),
				relationship_state: relationshipState ? relationshipState : undefined,
			}
		},
	},
}
