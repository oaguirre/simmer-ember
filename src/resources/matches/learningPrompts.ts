import { UserType } from '../user/model'
import { MomentType } from '../moment/model'
import { LeanDocument } from 'mongoose'
import { getUserCoreQAPairs } from './prompts'

const getApproxLocation = (user: Pick<UserType, 'loc_city' | 'loc_state' | 'loc_country'>): string => {
	const parts = [user.loc_city, user.loc_state, user.loc_country].filter(part => typeof part === 'string' && part.trim().length > 0)
	return parts.length > 0 ? parts.join(', ') : 'N/A'
}

export const learningPrompts = {
	v1: {
		prompt: `
      You are a helpful assistant that generates learning items
      based on user feedback from a memorable moments (usually dates between A and B, personal moments A or chats).
      The goal is to detect facts, preferences, avoidances, insights, hypotheses.

      Input format: 
      [{
        "moment_id": "string",
        "A": {
          "first_name": "string",
          "age": "number",
          "gender": "string",
          "location": "string",
          "questions_answers": [{"question": "string", "answer": "string"}],
          "high_priority_values": ["string"],
          "pets": "string",
          "want_kids": "string",
          "have_kids": "string",
          "smoking": "string",
          "relationship_status": "string"
        },
        "B": {
          "first_name": "string",
          "age": "number",
          "gender": "string",
          "location": "string",
          "questions_answers": [{"question": "string", "answer": "string"}],
          "high_priority_values": ["string"],
          "pets": "string",
          "want_kids": "string",
          "have_kids": "string",
          "smoking": "string",
          "relationship_status": "string"
        },
        "summary_a": "string",
        "summary_b": "string",
        "journal_a": "string",
        "journal_b": "string",
        "conversation": "string",
        "type": "date" | "party" | "meetup" | "friend_moment" | "personal_moment" | "chat_conversation" | "coach_moment" | "other",
        "universe": "simmer-world" | "reality",
        "source": "user" | "ai" | "external",
        "private_to_a": boolean, // if true, this moment should only be used to generate learnings for user A, and not for user B, even if user B is involved in the moment
        "match_score": "string",
        "tone_score": "string",
        "tags": ["string"],
        "location": "string",
        "chemistry_signals": "string",
        "conversational_balance": "string",
        "conversation_flow": "string",
        "curiosity": "string",
        "energy_alignment": "string",
        "humor_alignment": "string",
        "listening_responsiveness": "string",
        "repair_attempts": "string",
        "responsiveness": "string",
        "tension_handling": "string",
        "shared_moments": "string",
        "feedback": [
          {
            "source": "user_a" | "user_b" | "ai" | "manager" | "external",
            "validation_score": number, // optional score from 1-10 indicating how valid the feedback is
            "question": "string", // if question/answer style feedback, the question asked
            "answer": "string", // if question/answer style feedback, the answer provided
            "comment": "string" // any additional comments or context about the feedback
          }
         ],
       }]

      Output format:
      {
        summary: "string, one short sentence summarizing the main learning from this moment",
        facts: [string],
        preferences: [string],
        avoidances: [string],
        insights: [string],
        hypotheses: [string]        
       }
     `,
		getMomentInformation: async (moment: MomentType, userA: LeanDocument<UserType>, userB: LeanDocument<UserType> | null) => {
			const userAQA = getUserCoreQAPairs(userA as UserType)
			const userBQA = userB ? getUserCoreQAPairs(userB as UserType) : []
			return {
				A: {
					first_name: userA.first_name,
					age: userA.date_of_birth ? new Date().getFullYear() - new Date(userA.date_of_birth).getFullYear() : 'N/A',
					gender: userA.gender || 'N/A',
					location: getApproxLocation(userA),
					questions_answers: userAQA.map(({ question, answer }) => ({ question, answer })),
					high_priority_values: userA.high_priority_values || [],
				},
				...(userB
					? {
							B: {
								first_name: userB.first_name,
								age: userB.date_of_birth ? new Date().getFullYear() - new Date(userB.date_of_birth).getFullYear() : 'N/A',
								gender: userB.gender || 'N/A',
								location: getApproxLocation(userB),
								questions_answers: userBQA.map(({ question, answer }) => ({ question, answer })),
								high_priority_values: userB.high_priority_values || [],
							},
						}
					: {}),
				summary_a: moment.summary_a || '',
				summary_b: moment.summary_b || '',
				journal_a: moment.journal_a || [],
				journal_b: moment.journal_b || [],
				conversation: moment.conversation || '',
				type: moment.type,
				universe: moment.universe,
				source: moment.source,
				private_to_a: moment.private_to_a || false,
				match_score: moment.match_score || '',
				tone_score: moment.tone_score || '',
				tags: moment.tags || [],
				location: moment.location || '',
				chemistry_signals: moment.chemistry_signals || '',
				conversational_balance: moment.conversational_balance || '',
				conversation_flow: moment.conversation_flow || '',
				curiosity: moment.curiosity || '',
				energy_alignment: moment.energy_alignment || '',
				humor_alignment: moment.humor_alignment || '',
				listening_responsiveness: moment.listening_responsiveness || '',
				repair_attempts: moment.repair_attempts || '',
				responsiveness: moment.responsiveness || '',
				tension_handling: moment.tension_handling || '',
				shared_moments: moment.shared_moments || '',
				feedback: moment.feedback || [],
			}
		},
	},
}
