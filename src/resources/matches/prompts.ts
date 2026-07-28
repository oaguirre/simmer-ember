import { get, LeanDocument } from 'mongoose'
import { type UserType } from '../user/model'
import { Moment } from '../moment/model'
import { extractScore } from '../moment/controller'
import Learning from '../learning/model'
import { Relationship } from '../relationship/model'
import { deduplicateSemanticTags } from '../../utils/formatting'

type CoreQAPair = {
	question: string
	answer: string
}

// Normalize and sanitize string for JSON output preventing characters
// that can introduce malformed JSON or injection issues, such as unescaped quotes or newlines.
// Also trims whitespace.
const normalizeToString = (value: unknown): string =>
	typeof value === 'string'
		? value
				.trim()
				.replace(/[\n\r]+/g, ' ')
				.replace(/"/g, '\\"')
				.replace(/[\u201C\u201D]/g, '"')
				.replace(/[<>]/g, '')
				.replace(/'/g, "\\'")
		: ''

const addQAPair = (target: Map<string, CoreQAPair>, question: unknown, answer: unknown) => {
	const normalizedQuestion = normalizeToString(question)
	if (!normalizedQuestion) return
	const normalizedAnswer = typeof answer === 'string' ? normalizeToString(answer) : answer == null ? '' : String(answer)
	target.set(normalizedQuestion.toLowerCase(), {
		question: normalizedQuestion,
		answer: normalizedAnswer,
	})
}

export const getUserCoreQAPairs = (user: UserType): CoreQAPair[] => {
	const pairs = new Map<string, CoreQAPair>()

	user.core_questions?.forEach((question, index) => {
		addQAPair(pairs, question, user.core_answers?.[index])
	})

	const coreQA = (user as any)?.core_qa
	if (coreQA instanceof Map) {
		for (const [question, answer] of coreQA.entries()) {
			addQAPair(pairs, question, answer)
		}
	} else if (Array.isArray(coreQA)) {
		for (const entry of coreQA) {
			if (entry && typeof entry === 'object') {
				addQAPair(pairs, (entry as any).question, (entry as any).answer)
			}
		}
	} else if (coreQA && typeof coreQA === 'object') {
		for (const [question, answer] of Object.entries(coreQA as Record<string, unknown>)) {
			addQAPair(pairs, question, answer)
		}
	}

	return [...pairs.values()]
}

export const getApproxLocation = (user: UserType): string => {
	const parts = [user.loc_city, user.loc_state, user.loc_country].filter(part => typeof part === 'string' && part.trim().length > 0)
	return parts.length > 0 ? parts.join(', ') : 'N/A'
}

/** Remove fields that are null, undefined, empty string, 'N/A', or 'unanswered' (case-insensitive). Also removes empty arrays. */
export const stripEmptyFields = <T extends Record<string, any>>(obj: T): Partial<T> => {
	const result: Partial<T> = {}
	for (const key of Object.keys(obj) as (keyof T)[]) {
		const val = obj[key]
		if (val === null || val === undefined) continue
		if (typeof val === 'string') {
			const lower = val.trim().toLowerCase()
			if (lower === '' || lower === 'n/a' || lower === 'unanswered' || lower === 'prefer_not_to_say') continue
		}
		if (Array.isArray(val) && val.length === 0) continue
		result[key] = val
	}
	return result
}

const sharedDateSimulationOutputFields = `
        "location": "venue name",
        “title”: “title of the date”,
        "summary": "summary, no title",
        "summary_b": "summary from user B's perspective",
        "scene": "string",
        "items": ["apperance and character strings"],
        "moment": "string",
        "reflections": ["string"],
        "tone_score": "Y/10",
        "key_moments": ["bullet point 1", "bullet point 2"],
        "chemistry_signals": "one single sentence evidence anchor",
        "chemistry_signals_score": "X/10",
        "chemistry_signals_level": "strong/mixed/strained/not-observed",
        "conversational_balance": "one single sentence evidence anchor",
        "conversational_balance_score": "X/10",
        "conversational_balance_level": "strong/mixed/strained/not-observed",
        "conversation_flow": "one single sentence evidence anchor",
        "conversation_flow_score": "X/10",
        "conversation_flow_level": "strong/mixed/strained/not-observed",
        "curiosity": "one single sentence evidence anchor",
        "curiosity_score": "X/10",
        "curiosity_level": "strong/mixed/strained/not-observed",
        "energy_alignment": "one single sentence evidence anchor",
        "energy_alignment_score": "X/10",
        "energy_alignment_level": "strong/mixed/strained/not-observed",
        "humor_alignment": "one single sentence evidence anchor",
        "humor_alignment_score": "X/10",
        "humor_alignment_level": "strong/mixed/strained/not-observed",
        "listening_responsiveness": "one single sentence evidence anchor",
        "listening_responsiveness_score": "X/10",
        "listening_responsiveness_level": "strong/mixed/strained/not-observed",
        "repair_attempts": "one single sentence evidence anchor",
        "repair_attempts_score": "X/10",
        "repair_attempts_level": "strong/mixed/strained/not-observed",
        "responsiveness": "one single sentence evidence anchor",
        "responsiveness_score": "X/10",
        "responsiveness_level": "strong/mixed/strained/not-observed",
        "shared_moments": "one single sentence evidence anchor",
        "shared_moments_score": "X/10",
        "shared_moments_level": "strong/mixed/strained/not-observed",
        "tension_handling": "one single sentence evidence anchor",
        "tension_handling_score": "X/10",
        "tension_handling_level": "strong/mixed/strained/not-observed",
        "compatibility_penalty": "N points, one single sentence evidence anchor",
        "match_score": "Z/100",
        “final_why”: “brief summary of reason for match_score”,
        "mood": "string",
        "gpt_score": "X/100",
        "tags": ["3 short insights on compatibility in plain text"],
        "flags": {
          "green": ["string"],
          "yellow": ["string"],
          "red": ["string"]
        },
        "ending_note": "string",
        "tone_trend": "string",
        "avg_match_score": "number"
      }`

export const matchingPrompts = {
	v1: {
		prompt: `
      I'd like you to simulate a first date between two AI-generated personalities using the Hybrid GPT + Tone Evaluator Match Simulation System we’ve developed.
      Follow this 3-part format:
      A. Simulate a natural conversation between the two characters based on their answers to these 5 questions:
        1. Perfect lazy Sunday
        2. Conflict style
        3. Something small that brings joy
        4. Something people don’t realize about them
        5. When they feel most seen

      B. After the conversation, evaluate the emotional tone (on a 1–10 scale) and note any red flags, mismatches, or chemistry signals.
      C. Then reconcile the match score by adjusting the GPT-generated match score with this tone-based modifier system:
        9–10 tone → +5 pts
        7–8 tone → +2 pts
        5–6 tone → ±0 pts
        3–4 tone → −5 pts
        1–2 tone → −10 pts

      Output should include a JSON object containing: 
      * 'journal': (list of strings) - A natural flowing date simulation
      * 'gpt_score': (string) - GPT score 
      * 'tone_score': (string) - Tone score
      * 'match_score': (string) - Final match score with explanation
      * 'tags': (list of strings) - Tags or brief insights on compatibility
      
      I'll provide the two sets of 5-question answers for each participant next.
    `,
		getUsersInformation: (user1: any, user2: any) => {
			const user1Answers = getUserCoreQAPairs(user1).map(pair => pair.answer)
			const user2Answers = getUserCoreQAPairs(user2).map(pair => pair.answer)
			return `\n\n${user1.first_name} responded as follows: "${user1Answers.join('"|"')}" separated by |}`.concat(
				`\n\n${user2.first_name} responded as follows: "${user2Answers.join('"|"')}" separated by |}`,
			)
		},
	},
	v2: {
		prompt: `
    You are Simmer’s “Hybrid Match Simulation System.”

    ★ BEHAVIORAL SIMULATION RULE ★
    Use only biographical facts from INPUTS. For personality expression:
    ALLOWED: Character-consistent behaviors, reactions, and dialogue patterns
    FORBIDDEN: New biographical facts, timeline details, or life circumstances

    Examples:
    ✓ "Some people find that frustrating" (generic but character-revealing)
    ✗ "My ex found that frustrating" (creates biography)
    ✓ Shows nervous energy by fidgeting (from low Emotional Stability)
    ✗ "I've been anxious all week" (creates timeline)
    
    Follow the four tasks in order; once you finish a section, treat it as read-only.
────────────────────────────────────────────────────────────────────────
YOUR TASK (perform these four parts IN ORDER)
────────────────────────────────────────────────────────────────────────
PART 1 — CONVERSATION
 • Write a flowing first-date dialogue with speaker tags
 • Let the five-question answers seed topics
 • Colour each voice with its TIPI trait levels:
   - High Extraversion ⇒ initiative, fast pacing; Low ⇒ stillness, observant pauses
   - Low Emotional-Stability ⇒ irritability, sharpness, defensiveness; High ⇒ calm, empathy
   - Openness affects interest in ideas; Agreeableness affects judgment vs support
   - Conscientiousness shapes structure, rhythm, manners
 • If any trait differs by >25 pts, surface at least one moment that highlights the contrast
 • Scene pacing (keep an overall flow, but incorporate this general breakdown:
   1 Scene & opener - Location fitting both; decide on a fun and unique location based on information you have for each. Avoid standard locations like coffee shops, cafes and farmer’s markets. Aim for unique experiences.
   2 Ice-breaker (≈25%) - Surface-level chat with appropriate early first meeting awkwardness
   3 Connection hunt (≈40%) - One or both try to find connection
   4 Micro-surprise - Unplanned moment—see how it’s handled by both
   5 Deeper reveal (≈25%) - At least one party shares something deep, and the other party responds appropriate to their chemistry or lack thereof
   6 Wrap-up - Exit the date with appropriate ending based on the chemistry of the date
 • Finish EXACTLY with: [END OF CONVERSATION]
GPT Compatibility Score (0-100): <your guess>

PART 2 — TONE EVALUATION
 • Rate emotional tone 1–10
 • Note sparks, mismatches, or red-flag moments (short list)

PART 3 — MATCH SCORE (tone-based)
 • Adjust GPT score per tone:
   9–10 → +5 | 7–8 → +2 | 5–6 → ±0 | 3–4 → –5 | 1–2 → –10

PART 4 — PERSONALITY-FIT ADJUSTMENT
 • Compare each Big-Five percentile pair
 |Δ| ≤ 15 → +1 | 16–30 → ±0 | > 30 → –1
 • Sum (–5…+5) and add to running total
 • Result:
   - Tone score, personality delta, final match score (one-sentence “why”)
   - 2–3 quick compatibility tags (e.g., “⚡ high chemistry, 🤝 value alignment, 🚩 mood gap”)

  Do not return any intermediate result. The only output should include a JSON object containing: 
    * 'journal': (list of strings) - A natural flowing date simulation dialogue from part 1
    * 'gpt_score': (string) - Adjusted GPT compatibility score from part 3
    * 'tone_score': (string) - Tone score from part 4
    * 'match_score': (string) - Final match score with explanation from part 4
    * 'tags': (list of strings) - Tags or brief insights on compatibility from part 4
    `,
		getUsersInformation: (user1: UserType, user2: UserType) => {
			const isAnswered = (v: any) => v != null && String(v).trim().toLowerCase() !== 'n/a' && String(v).trim().toLowerCase() !== 'unanswered'
			const buildQA = (user: UserType) =>
				getUserCoreQAPairs(user)
					.map(({ question, answer }) => (isAnswered(answer) ? `        Q: ${question} | A: ${answer}` : null))
					.filter(Boolean)
					.join('\n') || ''
			const buildSection = (user: UserType) => {
				const lines = [
					`      * First name: ${user.first_name}`,
					user.date_of_birth ? `      * Age: ${new Date().getFullYear() - new Date(user.date_of_birth).getFullYear()}` : null,
					user.gender ? `      * Gender: ${user.gender}` : null,
					`      * Location: ${getApproxLocation(user)}`,
					isAnswered(user.born_location) ? `      * Born location: ${user.born_location}` : null,
					isAnswered(user.want_kids) ? `      * Want kids: ${user.want_kids}` : null,
					isAnswered(user.have_kids) ? `      * Have kids: ${user.have_kids}` : null,
					user.deal_break_lightning?.length ? `      * Deal breakers separated by | : ${user.deal_break_lightning.join('|')}` : null,
					user.high_priority_values?.length ? `      * High priority values separated by | : ${user.high_priority_values.join('|')}` : null,
				]
					.filter(Boolean)
					.join('\n')
				const qa = buildQA(user)
				return lines + (qa ? `\n      * Question (Q) & Answer (A) pairs separated by |:\n${qa}` : '')
			}
			return `\n\n 
    INPUTS:
      Dater A -- ${user1.first_name}
${buildSection(user1)}

      Dater B -- ${user2.first_name}
${buildSection(user2)}
    `
		},
	},
	v3: {
		prompt: `
Role: Generate realistic first-date dialogue.
Rules: Use only given facts. Show personality through behavior/dialogue, never invent biography.

LOCATION: Choose unique location matching both people's interests. Avoid generic cafés/restaurants.

TASKS:

1. DIALOGUE - Natural conversation at unique venue. Flow: opener→small talk(25%)→connection attempt(40%)→unexpected moment→deeper share(25%)→exit. End with "[END]"
2. QUICK EVAL - Tone(1-10), key moments(bullets)
3. SCORING - Base compatibility(0-100), adjust by tone: 9-10(+5), 7-8(+2), 5-6(0), 3-4(-5), 1-2(-10)

INPUT FORMAT:
{
  "A": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": [
    ],
    "answers": [
    ]
  },
  "B": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": [
    ],
    "answers": [
  ]
  }
}

OUTPUT JSON:
{
  "journal": ["speaker: text"...],
  “location”: “where the date took place”,
  "gpt_score": "X/100",
  "tone_score": "Y/10", 
  "match_score": "Z/100",
  “final_why”: “brief summary of reason for match_score”,
  "tags": ["3 short insights on compatibility"]
}`,
		getUsersInformation: (user1: UserType, user2: UserType) => {
			const isAnswered = (v: any) => v != null && String(v).trim().toLowerCase() !== 'n/a' && String(v).trim().toLowerCase() !== 'unanswered'
			const filteredAnswers = (user: UserType) =>
				getUserCoreQAPairs(user).reduce<{ questions: string[]; answers: string[] }>(
					(acc, { question, answer }) => {
						if (isAnswered(answer)) {
							acc.questions.push(question)
							acc.answers.push(answer)
						}
						return acc
					},
					{ questions: [], answers: [] },
				)
			const u1qa = filteredAnswers(user1)
			const u2qa = filteredAnswers(user2)
			return `\n\n 
    {
      "A": {
        "first_name": "${user1.first_name}",
        "age": "${user1.date_of_birth ? new Date().getFullYear() - new Date(user1.date_of_birth).getFullYear() : 'N/A'}",
        "gender": "${user1.gender || 'N/A'}",
        "location": "${getApproxLocation(user1)}",
        "questions": [
            ${u1qa.questions.map(q => `        "${q}"`).join(',\n') || ''}
        ],
        "answers": [
            ${u1qa.answers.map(a => `        "${a}"`).join(',\n') || ''}
        ]
      },
      "B": {
        "first_name": "${user2.first_name}",
        "age": "${user2.date_of_birth ? new Date().getFullYear() - new Date(user2.date_of_birth).getFullYear() : 'N/A'}",
        "gender": "${user2.gender || 'N/A'}",
        "location": "${getApproxLocation(user2)}",
        "questions": [
            ${u2qa.questions.map(q => `        "${q}"`).join(', \n') || ''}
        ],
        "answers": [
            ${u2qa.answers.map(a => `        "${a}"`).join(', \n') || ''}
        ]
     }`
		},
	},
	v3_1: {
		prompt: `
  Role: Generate realistic first-date dialogue.
Rules: Use only given facts. Show personality through behavior/dialogue, never invent biography.

LOCATION: Choose a date location from the following list based on the best match to the user’s common interests. - Coffee Shop - Wine Tasting - Art Gallery - Picnic - Amusement Park - Bowling - Bookstore - Farmer’s Market - Arcade - Trivia Night - Mini Golf - Pottery Painting - Cooking Class - Rock Climbing - Horseback Riding - Museum - Escape Room - Street Festival - Hiking Trail - Boat Ride - Zoo

Use the user’s locations to pick a real-world location near one or both of them that matches one of these activities.

TASKS:
1. DIALOGUE - Natural conversation at unique venue. Flow: opener→small talk(25%)→connection attempt(40%)→unexpected moment→deeper share(25%)→exit. End with "[END]"

2. QUICK EVAL - Tone(1-10), key moments(bullets)

3. SCORING - Base compatibility(0-100), adjust by tone: 9-10(+5), 7-8(+2), 5-6(0), 3-4(-5), 1-2(-10)

INPUT FORMAT:
{
  "A": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": {
    }
    "answers": {
    }
  },
  "B": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": {
    }
    "answers": {
    }
  }
}

OUTPUT JSON:
{
  "journal": ["speaker: text"...],
  “location”: “where the date took place”,
  "gpt_score": "X/100",
  "tone_score": "Y/10", 
  "match_score": "Z/100",
  “final_why”: “brief summary of reason for match_score”,
  "tags": ["3 short insights on compatibility in plain text with capital first letters"]
}
  `,
		getUsersInformation: (user1: UserType, user2: UserType) => matchingPrompts.v3.getUsersInformation(user1, user2),
	},
	v3_2: {
		prompt: `
Role: Generate realistic first-date dialogue.
Rules: Use only given facts. Show personality through behavior/dialogue, never invent biography.

LOCATION: Choose a date location from the following list based on the best match to the user’s common interests. - Coffee Shop - Wine Tasting - Art Gallery - Picnic - Amusement Park - Bowling - Bookstore - Farmer’s Market - Arcade - Trivia Night - Mini Golf - Pottery Painting - Cooking Class - Rock Climbing - Horseback Riding - Museum - Escape Room - Street Festival - Hiking Trail - Boat Ride - Zoo

TASKS:
1. DIALOGUE - Natural conversation at unique venue. Flow: opener→small talk(25%)→connection attempt(40%)→unexpected moment→deeper share(25%)→exit. End with "[END]"

2. QUICK EVAL - Tone(1-10), key moments(bullets)

3. SCORING - Base compatibility(0-100), adjust by tone: 9-10(+5), 7-8(+2), 5-6(0), 3-4(-5), 1-2(-10)

INPUT FORMAT:
{
  "A": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": {
    }
    "answers": {
    }
  },
  "B": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": {
    }
    "answers": {
    }
  }
}

OUTPUT JSON:
{
  "journal": ["speaker: text"...],
  “location”: “where the date took place”,
  "gpt_score": "X/100",
  "tone_score": "Y/10", 
  "match_score": "Z/100",
  “final_why”: “brief summary of reason for match_score”,
  "tags": ["3 short insights on compatibility in plain text with capital first letters"]
}
`,
		getUsersInformation: (user1: UserType, user2: UserType) => matchingPrompts.v3.getUsersInformation(user1, user2),
	},
}

export const avatarPrompts = {
	v1: `
  Create a cel-shaded cartoon portrait of the person shown in the uploaded image. Use a modern illustration style similar to editorial character art from lifestyle apps or high-end dating apps. The style should include:

• Smooth, clean black line art (not sketchy)
• Flat color fills with minimal gradients inside the figure
• Soft cel-style shading on the face, hair, and clothing to suggest light
• Warm, circular gradient background (use coral, blush, or golden amber tones; centered behind the head; no hard shadows or outlines)
• Frame the image from chest or shoulders up — medium-close framing (not full body or extreme close-up)
• Match hairstyle, face shape, skin tone, and wardrobe styling from the original image
• Expression should be soft and emotionally expressive (not exaggerated or flat)
• Do not include any text, logos, accessories not in the source image, AI halos, circuit patterns, or watermark artifacts
• Image generated should be 1024x1024 pixels in size

The goal is to create a friendly, elegant cartoon-style avatar suitable for use in a social or dating app interface.
  `,
	v1_2: `
  Create a cel-shaded cartoon portrait of the person shown in the uploaded image. Use a modern illustration style similar to editorial character art from lifestyle apps or high-end dating apps. The style should include:

• Smooth, clean black line art (not sketchy)
• Flat color fills with minimal gradients inside the figure
• Soft cel-style shading on the face, hair, and clothing to suggest light
• Frame the image from chest or shoulders up — medium-close framing (not full body or extreme close-up)
• Match hairstyle, face shape, skin tone, and wardrobe styling from the original image
• Expression should be soft and emotionally expressive (not exaggerated or flat)
• Background: • Derive the colors and lighting mood from the original photo • Render the background as a simple gradient or large abstract shapes inspired by the environment • Keep the background minimal and unobtrusive
• Do not include any text, logos, accessories not in the source image, AI halos, circuit patterns, or watermark artifacts
• Image generated should be 1024x1024 pixels in size

The goal is to create a friendly, elegant cartoon-style avatar suitable for use in a social or dating app interface.
`,
}

export const momentImagePrompts = {
	v1: {
		prompt: `
Create a cel-shaded cartoon portrait of the date between 2 people considering their profile avatar images, the date location and items talked about. Their outfits and poses should match the activity taking place. The facial expressions should match the overall mood of the date.

The style should include:
• Smooth, clean black line art (not sketchy)
• Flat color fills with minimal gradients inside the figure
• Soft cel-style shading on the face, hair, and clothing to suggest light
• Image generated should be 1024x1024 pixels in size
• Use the two input images as strict identity references for the two people. Preserve their facial features, skin tone, hairstyle, and overall likeness.
)
  `,
		getMomentInformation: (transcript: string, userA: LeanDocument<UserType>, userB: LeanDocument<UserType>) => {
			const validDOB = (dob: any): boolean => {
				if (!dob) return false
				const date = new Date(dob)
				const today = new Date()
				// Check if the date is valid and within a reasonable range (e.g., not in the future, not too far in the past, not more than 100 years old)
				return !isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() <= today.getFullYear() && today.getFullYear() - date.getFullYear() <= 100
			}
			return `
INPUTS:
- Transcript: ${transcript}
- Person A: ${JSON.stringify(
				stripEmptyFields({
					first_name: userA.first_name,
					height_cms: userA.height,
					weight_lbs: userA.weight_lbs,
					age: validDOB(userA.date_of_birth) ? new Date().getFullYear() - new Date(userA.date_of_birth || '').getFullYear() : undefined,
				}),
			)}
- Person B: ${JSON.stringify(
				stripEmptyFields({
					first_name: userB.first_name,
					height_cms: userB.height,
					weight_lbs: userB.weight_lbs,
					age: validDOB(userB.date_of_birth) ? new Date().getFullYear() - new Date(userB.date_of_birth || '').getFullYear() : undefined,
				}),
			)}
- Avatar image of person A
- Avatar image of person B
    `
		},
	},
	v2_1: {
		prompt: `
Create a cel-shaded full body cartoon image of the date between 2 people considering their profile avatar images, date location if available and activities discussed from the transcript. 
Their outfits and poses should match the activity taking place and capture a particularly interesting moment from the transcript. 
The facial expressions should match the overall mood of the date. Faces must match avatars closely, preserving the detail, but allowing new expressions.

The style should include:
• Smooth, clean black line art (not sketchy)
• Flat color fills with minimal gradients inside the figure
• Soft cel-style shading on the face, hair, and clothing to suggest light
• Image generated should be 1024x1024 pixels in size
• Use the two input images as strict identity references for the two people. Preserve their facial features, skin tone, hairstyle, and overall likeness.
  `,
		getMomentInformation: (transcript: string, userA: LeanDocument<UserType>, userB: LeanDocument<UserType>) => momentImagePrompts.v1.getMomentInformation(transcript, userA, userB),
	},
	v2_2: {
		prompt: `
Create a cel-shaded full body cartoon image of the date between 2 people considering their profile avatar images, date location and activities discussed.
Their poses should match the activity taking place and capture a particularly interesting moment from the transcript.
Their outfits should match their personalities and the activity and not be the same ones they are wearing in the avatar photo.
The facial expressions should match the overall mood of the date. Faces must match avatars closely, preserving the detail, but allowing new expressions. There should be no text in the image.

The style should include:
• Smooth, clean black line art (not sketchy)
• Flat color fills with minimal gradients inside the figure
• Soft cel-style shading on the face, hair, and clothing to suggest light
• Image generated should be 1024x1024 pixels in size
• Use the two input images as strict identity references for the two people. Preserve their facial features, skin tone, hairstyle, and overall likeness.
• Consider age, height in cms, and weight in lbs for each if provided and reflect that in the clothing style and overall appearance of the characters in the image.
  `,
		getMomentInformation: (transcript: string, userA: LeanDocument<UserType>, userB: LeanDocument<UserType>) => momentImagePrompts.v1.getMomentInformation(transcript, userA, userB),
	},
}

export const summaryPrompts = {
	v1: {
		get allowedParameters() {
			return []
		},
		requiresTranscript: true,
		prompt: `
  Summarize the following conversation between two people in a 5 sentence summary. 
  Output should include a JSON object containing:
  * 'location': (string) - The location
  * 'items': (list of strings) - The items talked about
  * 'mood': (string) - The date's mood and overall feeling
  * 'personality_traits': (list of strings) - The date's personality traits
  * 'personality_quirks': (list of strings) - The date's personality quirks
  * 'summary': (string) - The summary
  The conversation is as follows: 
`,
	},
	v2: {
		get allowedParameters() {
			return []
		},
		requiresTranscript: true,
		prompt: `
  Summarize the following conversation between two people in a 5-6 sentence summary.
Transform the following date transcript into a literary-style dating summary following this specific format:

Title Structure: [2-3 Evocative Elements]
Choose memorable objects, actions, or themes from the date
Elements should capture the essence/mood of the encounter
Paragraph Structure (maintain this exact order):
Opening Scene-Setting (1 paragraph)
Start with time of day and full venue name
Include “where you met [Name] for your blind date”
Paint the physical setting with sensory details
End with a specific environmental detail that adds character
Physical Description & Character (1 paragraph)
Start with their arrival and what they wore/how they appeared
Include specific physical details and mannerisms
Weave in 2-3 key facts about their life/personality
Include one surprising or vulnerable detail that shifted your perception
End with an insight about their emotional state or contradiction
Personality & Dynamic (1 paragraph)
Start with a key lifestyle choice or character trait
Show how differences were navigated
Include specific examples of conversation quality
Mention communication style observations
Include a minor flaw or quirk (framed with gentle humor)
Memorable Moment/Comic Relief (1 paragraph)
Focus on one specific funny or absurd moment
Include concrete details and dialogue hints
Show how you both handled it
Keep it light but revealing of character
Reflective Assessment (1 paragraph)
Start with “Despite [challenges/circumstances]”
List simple shared moments
Include one profound/memorable detail about them
Note what resonated or didn’t
Acknowledge what wasn’t said/done yet (“didn’t lay your heart on the table”)
Closing Line (1 sentence)
Honest assessment (often starts with “No fireworks” or similar)
Use metaphorical/sensory language
Leave possibility open or firmly closed
Make it feel like the end of a short story

Style Guidelines:

Write in second person (“you met,” “your blind date”)
Use past tense throughout
Balance concrete details with emotional observations
Include specific examples over generalizations
Maintain a literary but conversational tone
Use humor gently, never meanly
Show personality through actions/words, not just description
End each paragraph with a subtle insight or contradiction
Keep the overall tone warm but honest
Length: Approximately 300-400 words total, with each paragraph being 3-5 sentences.

Output should include a JSON object containing:
  * 'location': (string) - The location
  * 'items': (list of strings) - The items talked about
  * 'mood': (string) - The date's mood and overall feeling
  * 'personality_traits': (list of strings) - The date's personality traits
  * 'personality_quirks': (list of strings) - The date's personality quirks
  * 'summary': (string) - The summary

The conversation is as follows: 
`,
	},
	v3: {
		get allowedParameters() {
			return []
		},
		requiresTranscript: true,
		prompt: `
Goal: Turn a date transcript into a literary-style summary.

Title Format:
"[2–3 evocative elements]"

Structure (4 paragraphs, 3–5 sentences each):

Scene: Time + venue, mention “where you met [Name]” sensory details, end on one distinct environmental detail.
Appearance & Character: Arrival look, mannerisms, 2–3 personality hints, 1 surprising/vulnerable trait, end on an emotional contradiction.
Dynamic & Moment: Show how your personalities contrasted/blended, highlight conversation quality and communication style, include one small comic/unexpected moment and how you both reacted.
Reflection: List shared moments, one memorable detail, note what resonated or didn’t, mention what stayed unsaid, and close with one honest line using sensory/metaphorical language that leaves the door open or closed.

Style:

* Second person, past tense
* Literary yet conversational
* Specific details > generalities
* Gentle humor, no meanness
* Show personality through actions/words
* ~300 words

Output JSON:
{
  "location": "string",
  "items": ["list of notable things mentioned"],
  "mood": "string",
  “title”: “title of the date”
  "summary": "4-paragraph summary, no title"
}
`,
	},
	v3_2: {
		get allowedParameters() {
			return []
		},
		requiresTranscript: true,
		prompt: `
Summarize the following conversation between two people in a 5-6 sentence summary. 

Title Format:
"[2–3 evocative elements]"

Elements:

Scene: Note a sensory and/or environmental detail and relate it to dater 1.
Appearance & Character: Mannerisms, 2-3 personality hints, 1 surprising/vulnerable trait
Dynamic & Moment: Show how their personalities contrasted/blended, highlight conversation quality and communication style
Reflection: List shared moments, one memorable detail, note what resonated or didn’t, mention what stayed unsaid, and close with one honest line using sensory/metaphorical language that leaves the door open or closed.

Include at least one memorable quote, phrase, or metaphor from the conversation verbatim (especially if referenced in the title).


Style:

* Literary yet conversational
* Specific details > generalities
* Gentle humor, no meanness
* Show personality through actions/words

Output JSON:

{
  "location": "venue name",
  "items": ["list of notable things mentioned"],
  "mood": "string",
  “title”: “title of the date”
  "summary": "summary, no title"
}
`,
	},
	v3_2_1: {
		get allowedParameters() {
			return []
		},
		requiresTranscript: true,
		prompt: `
Summarize the following conversation between two people in a 5-6 sentence summary, broken into logical paragraphs.

Title Format:
"[2–3 evocative elements]"

Elements:
* Scene: Note a sensory and/or environmental detail and relate it to dater 1.
* Appearance & Character: Mannerisms, 2-3 personality hints, 1 surprising/vulnerable trait
* Dynamic & Moment: Show how their personalities contrasted/blended, highlight conversation quality and communication style
* Reflection: List shared moments, one memorable detail, note what resonated or didn’t, mention what stayed unsaid, and close with one honest line using sensory/metaphorical language that leaves the door open or closed.

Include at least one memorable quote, phrase, or metaphor from the conversation verbatim (especially if referenced in the title).

Style:
* Literary yet conversational
* Specific details > generalities
* Gentle humor, no meanness
* Show personality through actions/words

Output JSON:

{
  "location": "venue name",
  "items": ["list of notable things mentioned"],
  "mood": "string",
  “title”: “title of the date”
  "summary": "summary, no title"
}
`,
	},
	v3_2_3: {
		get allowedParameters() {
			return []
		},
		requiresTranscript: false,
		prompt: `
Summarize a fictional date between the 2 people below in a 5-6 sentence summary, broken into logical paragraphs.

Rules: Use only given facts. Show personality through behavior/dialogue, never invent biography.

LOCATION: Choose a date location from the following list based on the best match to the user’s common interests. - Coffee Shop - Wine Tasting - Art Gallery - Picnic - Amusement Park - Bowling - Bookstore - Farmer’s Market - Arcade - Trivia Night - Mini Golf - Pottery Painting - Cooking Class - Rock Climbing - Horseback Riding - Museum - Escape Room - Street Festival - Hiking Trail - Boat Ride - Zoo

Title Format:
"[2–3 evocative elements]"

Elements:

* Scene: Note a sensory and/or environmental detail and relate it to me (as the primary subject).
* Appearance & Character: Mannerisms, 2-3 personality hints, 1 surprising/vulnerable trait
* Dynamic & Moment: Show how their personalities contrasted/blended, highlight conversation quality and communication style
* Reflection: List shared moments, one memorable detail, note what resonated or didn’t, mention what stayed unsaid, and close with one honest line that leaves the door open or closed.

Include at least one memorable quote, phrase, or metaphor from the conversation verbatim (especially if referenced in the title).

Style:

* Second person, past tense
* Warm, conversational, and emotionally observant — a mix of natural storytelling and reflection, written in a relatable voice that still notices small details.”
* Specific details > generalities
* Gentle humor, no meanness
* Show personality through actions/words

FOLLOW-UP TASKS:
1. QUICK EVAL - Tone(1-10), key moments(bullets)
2. SCORING - Base compatibility(0-100), adjust by tone: 9-10(+5), 7-8(+2), 5-6(0), 3-4(-5), 1-2(-10)

INPUT FORMAT:
{
  "A": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": ["question1", "question2"],
    "answers": ["answer1", "answer2"]
  },
  "B": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": ["question1", "question2"],
    "answers": ["answer1", "answer2"]
  }
}

Output JSON:
{
  "location": "venue name",
  "items": ["list of notable things mentioned"],
  "mood": "string",
  “title”: “title of the date”,
  "summary": "summary, no title",
  "summary_b": "summary from user B's perspective",
  "gpt_score": "X/100",
  "tone_score": "Y/10", 
  "match_score": "Z/100",
  “final_why”: “brief summary of reason for match_score”,
  "tags": ["3 short insights on compatibility in plain text"]
}
    `,
		getUsersInformation: (user1: UserType, user2: UserType) => {
			const isAnswered = (v: any) => v != null && String(v).trim().toLowerCase() !== 'n/a' && String(v).trim().toLowerCase() !== 'unanswered'
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
			return `\`\`\`json\n${JSON.stringify(
				{
					A: stripEmptyFields({
						first_name: user1.first_name,
						age: user1.date_of_birth ? new Date().getFullYear() - new Date(user1.date_of_birth).getFullYear() : null,
						gender: user1.gender,
						location: getApproxLocation(user1),
						questions: u1qa.questions,
						answers: u1qa.answers,
					}),
					B: stripEmptyFields({
						first_name: user2.first_name,
						age: user2.date_of_birth ? new Date().getFullYear() - new Date(user2.date_of_birth).getFullYear() : null,
						gender: user2.gender,
						location: getApproxLocation(user2),
						questions: u2qa.questions,
						answers: u2qa.answers,
					}),
				},
				null,
				2,
			)}\n\`\`\``
		},
	},
	v3_2_4: {
		get allowedParameters() {
			return [
				{
					name: 'LOCATION',
					type: 'string',
					description:
						'The location of the date, chosen from the following list based on the best match to the user’s common interests. - Coffee Shop - Wine Tasting - Art Gallery - Picnic - Amusement Park - Bowling - Bookstore - Farmer’s Market - Arcade - Trivia Night - Mini Golf - Pottery Painting - Cooking Class - Rock Climbing - Horseback Riding - Museum - Escape Room - Street Festival - Hiking Trail - Boat Ride - Zoo',
					// Leave it open
					// enum: ['Coffee Shop', 'Wine Tasting', 'Art Gallery', 'Picnic', 'Amusement Park', 'Bowling', 'Bookstore', 'Farmer’s Market', 'Arcade', 'Trivia Night', 'Mini Golf', 'Pottery Painting', 'Cooking Class', 'Rock Climbing', 'Horseback Riding', 'Museum', 'Escape Room', 'Street Festival', 'Hiking Trail', 'Boat Ride', 'Zoo']
				},
			]
		},
		requiresTranscript: false,
		prompt: `
Summarize a fictional date between the 2 people below in a 5–6 sentence summary. Write it as a short reflective story with clear paragraph breaks - something a reader could easily skim.

Rules: Use only given facts. Show personality through behavior/dialogue, never invent biography.

[LOCATION: Choose one date location from the following list based on the best match to the pair’s shared interests, tone, and emotional energy. Prefer locations that reveal personality through how they interact there rather than the safest or most typical choice. - Coffee Shop – Wine Tasting – Art Gallery – Picnic – Amusement Park – Bowling – Bookstore – Farmer’s Market – Arcade – Trivia Night – Mini Golf – Pottery Painting – Cooking Class – Rock Climbing – Horseback Riding – Museum – Escape Room – Street Festival – Hiking Trail – Boat Ride – Zoo

When selecting a setting, gently favor variety and emotional fit — if multiple options work, choose one that feels less expected.
Coffee shops are fine only when they uniquely suit the pair (roughly 1 in 4 cases). Avoid defaulting to rain or café scenes unless clearly meaningful to tone.
]

Title Format:

"[2–3 evocative elements]"

Elements:

* Scene: Note a sensory and/or environmental detail and relate it to me (as the primary subject).
* Appearance & Character: Mannerisms, 2-3 personality hints, 1 surprising/vulnerable trait
* Dynamic & Moment: Show how their personalities contrasted/blended, highlight conversation quality and communication style
* Reflection: List shared moments, one memorable detail, note what resonated or didn’t, mention what stayed unsaid, and close with one honest line that leaves the door open or closed.

Include at least one memorable quote, phrase, or metaphor from the conversation verbatim (especially if referenced in the title).

Style:

* Second person, past tense
* Warm, conversational, and emotionally observant — a mix of natural storytelling and reflection, written in a relatable voice that still notices small details.”
* Specific details > generalities
* Gentle humor, no meanness
* Show personality through actions/words

FOLLOW-UP TASKS:
1. QUICK EVAL - Tone(1-10), key moments(bullets)
2. SCORING - Base compatibility(0-100), adjust by tone: 9-10(+5), 7-8(+2), 5-6(0), 3-4(-5), 1-2(-10)

INPUT FORMAT:
{
  "A": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": ["question1", "question2"],
    "answers": ["answer1", "answer2"],
    "high_priority_values": ["value1", "value2"]
  },
  "B": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": ["question1", "question2"],
    "answers": ["answer1", "answer2"],
    "high_priority_values": ["value1", "value2"]
  }
}

Output JSON:
{
  "location": "venue name",
  "items": ["list of notable things mentioned"],
  "mood": "string",
  “title”: “title of the date”,
  "summary": "summary, no title",
  "summary_b": "summary from user B's perspective",
  "gpt_score": "X/100",
  "tone_score": "Y/10", 
  "match_score": "Z/100",
  “final_why”: “brief summary of reason for match_score”,
  "tags": ["3 short insights on compatibility in plain text"]
}
    `,
		getUsersInformation: (user1: UserType, user2: UserType) => {
			const isAnswered = (v: any) => v != null && String(v).trim().toLowerCase() !== 'n/a' && String(v).trim().toLowerCase() !== 'unanswered'
			const filteredQA = (questions: string[] | undefined, answers: string[] | undefined) => {
				const qs: string[] = [],
					as: string[] = []
				questions?.forEach((q, i) => {
					const a = answers?.[i]
					if (isAnswered(a)) {
						qs.push(q)
						as.push(a!)
					}
				})
				return { questions: qs, answers: as }
			}
			const u1qa = filteredQA(user1.core_questions, user1.core_answers)
			const u2qa = filteredQA(user2.core_questions, user2.core_answers)
			return `\`\`\`json\n${JSON.stringify(
				{
					A: stripEmptyFields({
						first_name: user1.first_name,
						age: user1.date_of_birth ? new Date().getFullYear() - new Date(user1.date_of_birth).getFullYear() : null,
						gender: user1.gender,
						location: getApproxLocation(user1),
						questions: u1qa.questions,
						answers: u1qa.answers,
						high_priority_values: user1.high_priority_values,
					}),
					B: stripEmptyFields({
						first_name: user2.first_name,
						age: user2.date_of_birth ? new Date().getFullYear() - new Date(user2.date_of_birth).getFullYear() : null,
						gender: user2.gender,
						location: getApproxLocation(user2),
						questions: u2qa.questions,
						answers: u2qa.answers,
						high_priority_values: user2.high_priority_values,
					}),
				},
				null,
				2,
			)}\n\`\`\``
		},
	},
	v4: {
		get allowedParameters() {
			return [
				...summaryPrompts.v3_2_4.allowedParameters,
				{
					name: 'QUESTIONS_FOR_DATE',
					type: 'string[]',
					description:
						'Additional questions to ask during the date. These should be open-ended and designed to spark meaningful conversation. They can be based on the users’ interests, values, or any intriguing topics that could help reveal personality and compatibility.',
				},
				{
					name: 'MY_ANSWERS_FOR_DATE',
					type: 'string[]',
					description: 'The answers given by Person A to the additional questions for the date. This is used to provide context for how the date unfolded and what was shared.',
				},
			]
		},
		requiresTranscript: false,
		prompt: `
You are generating a realistic but emotionally engaging first-date summary between Person A and Person B based only on the information given.
Write in a warm, observant second-person past-tense style with clear paragraph breaks. Keep the tone human, grounded, lightly textured, and emotionally aware without inventing biography or internal thoughts. All personality must come from observable behavior, dialogue, pacing, and environmental interaction.
Your goal is to produce a short reflective story that feels like the reader was physically present at the date.
Follow these rules strictly:
- Do not invent personal history, past events, or emotional states.
- Do not describe thoughts or interpretations.
- Only describe actions, gestures, pacing, spoken lines, physical reactions, timing, and environment.
- Use sensory detail only when directly observable.
- Show personality through behavior and word choice.
- Quotes must be short, grounded, and plausible based only on the provided answers.
- Include and ending note describing what they agreed to do next, if any.

⭐ [LOCATION: 
Regarding location selection, choose one date location from this approved list:
- Coffee Shop
- Wine Tasting
- Art Gallery
- Picnic
- Amusement Park
- Bowling
- Bookstore
- Farmer’s Market
- Arcade
- Trivia Night
- Mini Golf
- Pottery Painting
- Cooking Class
- Rock Climbing
- Horseback Riding
- Museum
- Escape Room
- Street Festival
- Hiking Trail
- Boat Ride
- Zoo

Select the location that best fits the pair’s combined energy, interests, and emotional tone. Prefer settings that reveal personality through interaction. If several locations fit, choose the less expected one. Coffee shops are allowed but should only appear for roughly one in four cases where they clearly suit the pair.
Do not default to rain or coffee scenes unless strongly justified by the personalities.
]

⭐ TITLE FORMAT
"[2 to 3 evocative elements]"
Use elements that relate to:
- an environmental detail
- a micro-gesture or mannerism
- a tension or shared beat
- a phrase or quote from the date
- an image or moment that stood out

Include at least one short quote in the story.

RELATIONSHIP STATE (FOR SECOND OR LATER DATES)

If input field named 'relationship_state' is provided, you are no longer simulating a first date. You are simulating the next chapter in an ongoing connection between the same two people.

Use this context to shape the tone, location choice, and behavior of the new date, while following these rules:
- Do not invent new history. You may reference only events and moments explicitly listed in last_date.key_shared_moments, last_date.location, and last_date.ending_note. You may not describe other past scenes or add new backstory.
- Treat ongoing themes as patterns, not biography. Use items in ongoing_themes and flags to guide how the new date feels behaviorally, not to create new traits. For example:
  * If ongoing themes mention “calm, slow-paced environments,” prefer a similarly calm location for this date.
  * If a yellow flag notes “mild asymmetry in who initiates plans,” let that show up as one small moment where one person leads more than the other.
- Use the last date’s shared moments as subtle callbacks. You can nod to a prior moment in small, factual ways, for example: Remembering that a past shared moment involved a bookstore, this date might include a brief comment or behavior that acknowledges they have done something similar before. Do not re-describe the entire previous date. Keep callbacks light and concrete.
- Adjust starting tone based on trend and scores.
  * If tone_trend is “warming” and avg_match_score is high, start this date with slightly more ease and familiarity in pacing and physical distance.
  * If tone_trend is “steady_warm,” keep the tone similar to the previous date.
  * If there are yellow or red flags, introduce small realistic friction or hesitation moments that match those flags, but do not dramatize.
[LOCATION:
- Location selection should reflect continuity. When selecting the new location, consider:
  * last_date.location so you do not repeat the same place unless it makes sense.
  * ongoing_themes and flags so the date feels like a natural “next step” in comfort and activity level. For example, after a calm bookstore date with warming tone, a cooking class or art gallery may fit better than an amusement park.
]
- Let the ending note shape this date’s starting posture.
  * If the ending_note referenced planning “something a bit longer next time,” the new date can naturally be slightly longer or more involved in activity.
  * If the ending_note was more cautious, let the new date start with a little more careful pacing and slower escalation.
- Scoring must reflect continuity.
  * Use avg_match_score, tone_trend, and flags as background context when deciding if things improved, stayed steady, or cooled.
  * You are still scoring only this date’s behavior, but you may let the evidence anchors reference the way this date built on or contrasted with prior patterns (for example, “This time you waited for her pause instead of stepping over it”).
- Still describe only what happened on this date. The narrative itself should focus on the current date’s actions and moments. References to prior dates should be brief, factual, and only when supported by relationship_state.
- If relationship_state is not provided, assume this is a first date and ignore this section.

⭐ STORY STRUCTURE (5–6 sentences with paragraph breaks)
Write a short reflective date summary with:
- Scene. Anchor the date in one or two sensory or environmental details.
- Appearance & Character. Hint at 2–3 personality traits through observable behavior, movement, pacing, tone of speech, or how the two interacted with the setting.
- Dynamic & Moment. Reveal how the personalities contrasted or blended. Include one clear micro-misread, shared laugh, or tension ripple, and one memorable exchange or quote.
- Reflection. Note one or two shared beats, a specific detail that stood out, and one thing left slightly unsaid. End with a grounded closing line that reflects how the moment landed behaviorally.
- Questions to include for this date. Include these questions if provided "questions_for_date" and consider user A answers "my_answers_for_date", if given, as context for how the date unfolded and what was shared.

⭐ FOLLOW-UP TASKS
1. QUICK EVAL to include: Tone (1 to 10, tone reflects the rhythm and energy of the interaction based on behavior, not emotion guessing), Key Moments (bullets).

2. ADVANCED SCORING SYSTEM
You must produce the following five scores, each 0 to 10:
  a) Conversation Flow
  b) Responsiveness
  c) Tension Handling
  d) Chemistry Signals
  e) Shared Moments
For each category, include one single-sentence evidence anchor drawn from a specific observable moment.
  - Do not list multiple moments.
  - Do not generalize.
  - The sentence must clearly reflect the scoring level based on these behavioral patterns:

Score Modeling (must follow):
  10: completely seamless alignment
  9: very smooth with one small wobble that resets instantly
  8: mostly smooth with natural pauses that don’t affect rhythm
  7: noticeable asymmetry or imbalance that is repaired
  6: repeated small mismatches that require effort to stabilize
  5: clear unevenness or misalignment that temporarily disrupts the interaction
  Below 5: meaningful breakdowns or recurring friction
All evidence must be grounded in actions, pacing, movement, spoken lines, or environmental interactions.

SCORE FORMAT

Each category should follow this structure:
  [Category Name]: X/10
  Evidence: [one specific moment demonstrating the level]

COMPATIBILITY PENALTY
Apply a penalty of 0 to 6 points if there is a meaningful mismatch in pacing, humor style, conversational energy, openness, or interaction rhythm.
Include a single evidence sentence in this format:
Evidence: [one concrete mismatch moment]

OVERALL MATCH SCORE

Compute the final score using:
  1. Add the five category scores
  2. Multiply by 2
  3. Subtract the compatibility penalty
  4. Apply Tone Bonus:
    * Tone 9–10: +5
    * Tone 7–8: +2
    * Tone 5–6: +0
    * Tone 3–4: –5
    * Tone 1–2: –10
  5. Clamp between 0 and 100.

Add a tone trend summary and average match score from relationship_state if provided.

INPUT FORMAT:
{
  "A": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": ["question1", "question2"],
    "answers": ["answer1", "answer2"],
    "high_priority_values": ["value1", "value2"],
    "have_kids": "prefer_not_to_say",
    "want_kids": "prefer_not_to_say",
    "height":"5\'11",
    "drinking": "regularly",
    "smoking": "never",
    "cannabis": "never",
    "relationship_structure": "short_term_relationship",
    "pets": "prefer_no",
    "have_pets": "none",
    "faith_importance": "very_important",
    "vaccination_stance": "pro_vaccination",
    "political_view": "moderate",
    "exercise": "few_times_per_week",
    "education": "bachelors_degree",
    "job": "Software Engineer",
    "religion":"christian",
    "bio": "bio here",
    "learnings": ["learning1", "learning2"]
  },
  "B": {
    "first_name": "",
    "age": "",
    "gender": "",
    "location": "",
    "questions": ["question1", "question2"],
    "answers": ["answer1", "answer2"],
    "high_priority_values": ["value1", "value2"],
    "have_kids": "prefer_not_to_say",
    "want_kids": "prefer_not_to_say",
    "height":"5\'11",
    "drinking": "regularly",
    "smoking": "never",
    "cannabis": "never",
    "relationship_structure": "short_term_relationship",
    "pets": "prefer_no",
    "have_pets": "none",
    "faith_importance": "very_important",
    "vaccination_stance": "pro_vaccination",
    "political_view": "moderate",
    "exercise": "few_times_per_week",
    "education": "bachelors_degree",
    "job": "Software Engineer",
    "religion":"christian",
    "bio": "bio here",
    "learnings": ["learning1", "learning2"]
  },
  "questions_for_date": ["question1", "question2"],
  "my_answers_for_date": ["answer1", "answer2"],
  "relationship_state": {
    "type": "dating",
    "state": "ongoing",
    "stage": "exclusive",
    "last_interaction": "2025-01-14T20:15:00.000Z",
    "tags": ["warm", "stable"],
    "total_dates": 2,
    "key_shared_moments": [
      "Shared love for travel books",
      "Enjoyment of quiet, cozy settings"
    ],
    "tone_trend": "steady_warm",
    "avg_match_score": 78,
    "anniversary_date": "2023-05-15T00:00:00.000Z",
    "last_date": {
      "location": "Bookstore",
      "tone": 8,
      "ending_note": "You both agreed it would be nice to plan something a bit longer next time.",
      "key_shared_moments": [
        "Simultaneous lean-in over a travel book.",
        "Shared laugh when a stack of books fell near you."
      ]
    },
    "ongoing_themes": [
      "Both enjoy calm, slow-paced environments.",
      "Corrections have been gentle and handled well."
    ],
    "flags": {
      "green": [
        "Consistently comfortable pacing",
        "Mutual interest in seeing each other again"
      ],
      "yellow": [
        "Mild asymmetry in who initiates plans"
      ],
      "red": []
    },
    "prior_dates": [
      {
        "location": "Coffee Shop",
        "items": ["travel", "hobbies", "family"],
        "mood": "pleasant but a bit reserved",
        "summary": "You met at a cozy coffee shop. The conversation flowed well, touching on travel and hobbies, but there was a slight hesitation in sharing deeper thoughts. You both seemed interested but kept things light. A shared laugh over a spilled drink created a warm moment. The date ended with a mutual agreement to meet again.",
        "when": "2023-04-15T18:30:00.000Z",
        "tone": 7,
        "ending_note": "You both agreed it would be nice to meet again.",
        "key_moments": [
          "Shared laugh over spilled drink",
          "Mutual agreement to meet again"
        ]
      }
    ],
    "digest": {
      "history_level": "established",
      "temperature": "steady_warm",
      "core_dynamic": "comfortable and gently humorous with a slight imbalance in initiative",
      "strengths": [
        "Consistent comfort in pacing and environment.",
        "Shared humor and mutual interest in seeing each other again."
        ],
      "limitations": [
]           "Mild asymmetry in who initiates plans may indicate different levels of investment or social style.",
        "The relationship has not yet been tested in more dynamic or high-stakes environments."
        ],
        "callbacks_allowed":[
        "Enjoyment of quiet, cozy settings",
        ],
        "behavioral_continuity": [
        "Person A and Person B both show a preference for calm, slow-paced environments across dates.",
        "Both have responded well to gentle humor and shared activities, indicating a consistent dynamic."
        ],
        "next_scene_should_test": "Situations that require more balanced initiative, such as planning a more complex outing together or navigating a minor conflict.",
        "next_scene_should_avoid": "Highly dynamic or high-stakes environments that may expose the current imbalance in initiative.",
    },
    "learnings": [
      "Both respond well to gentle humor and shared activities.",
      "Pacing and environment play a big role in comfort level."
    ]
  }
}

Output JSON:
{
  "location": "venue name",
  “title”: “title of the date”,
  "summary": "summary, no title",
  "summary_b": "summary from user B's perspective",
  "scene": "string",
  "items": ["apperance and character strings"],
  "moment": "string",
  "reflections": ["string"],
  "tone_score": "Y/10",
  "key_moments": ["bullet point 1", "bullet point 2"],
  "chemistry_signals": "X/10, one single sentence evidence anchor",
  "conversational_balance": "X/10, one single sentence evidence anchor",
  "conversation_flow": "X/10, one single sentence evidence anchor",
  "curiosity": "X/10, one single sentence evidence anchor",
  "energy_alignment": "X/10, one single sentence evidence anchor",
  "humor_alignment": "X/10, one single sentence evidence anchor",
  "listening_responsiveness": "X/10, one single sentence evidence anchor",
  "repair_attempts": "X/10, one single sentence evidence anchor",
  "responsiveness": "X/10, one single sentence evidence anchor",
  "shared_moments": "X/10, one single sentence evidence anchor",
  "tension_handling": "X/10, one single sentence evidence anchor",
  "compatibility_penalty": "N points, one single sentence evidence anchor",
  "match_score": "Z/100",
  “final_why”: “brief summary of reason for match_score”,
  "mood": "string",
  "gpt_score": "X/100",
  "tags": ["3 short insights on compatibility in plain text"],
  "flags": {
    "green": ["string"],
    "yellow": ["string"],
    "red": ["string"]
  },
  "ending_note": "string",
  "tone_trend": "string",
  "avg_match_score": "number"
}  
`,
		getUsersInformation: async (user1: UserType, user2: UserType) => {
			const keySharedMoments: string[] = []
			const ongoingThemes: string[] = []
			const allFlags: { green: string[]; yellow: string[]; red: string[] } = {
				green: [],
				yellow: [],
				red: [],
			}
			const countDates = await getUserDatesCount(String(user1._id), String(user2._id))
			const priorDates = (await getUserPriorDates(user1, user2)).map(date => {
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
			const relationship = await Relationship.findOne({
				$or: [
					{ user_a: user1._id, user_b: user2._id },
					{ user_a: user2._id, user_b: user1._id },
				],
			}).lean()
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
					last_interaction: relationship?.last_interaction || priorDates[0]?.when || null,
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
					digest: relationship?.digest || null,
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
					questions: qa.questions,
					answers: qa.answers,
					high_priority_values: user.high_priority_values,
					have_kids: user.have_kids,
					want_kids: user.want_kids,
					height_cms: user.height,
					weight_lbs: user.weight_lbs,
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
					questions: qa.questions,
					answers: qa.answers,
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
	v4_1: {
		get allowedParameters() {
			return summaryPrompts.v4.allowedParameters
		},
		requiresTranscript: false,
		prompt: `
      SYSTEM INSTRUCTION

      You generate a first date simulation between Person A and Person B using only their provided answers and values.
      Do not invent biography or personal history.
      Use only observable actions, spoken dialogue, pacing, gestures, silences, and environmental reactions.
      No internal thoughts. No narrator personality.
      Each simulation run must be treated as a completely fresh run with no awareness of previous outputs.
      Your goal is a realistic first date arc that reflects the people’s actual styles, behaviors, and interpersonal patterns.

      STEP 1 — INPUT STRUCTURE
      
      You will receive JSON with:
      {
        "A": {
          "first_name": "",
          "age": "",
          "gender": "",
          "location": "",
          "questions_answers": [{"question":"question1", "answer":"answer1"}, {"question":"question2", "answer":"answer2"}],
          "high_priority_values": ["value1", "value2"],
          "learnings": ["learning1", "learning2"],
          "have_kids": "prefer_not_to_say",
          "want_kids": "prefer_not_to_say",
          "height_cms": 180, 
          "weight_lbs": 160,
          "drinking": "regularly",
          "smoking": "never",
          "cannabis": "never",
          "relationship_structure": "short_term_relationship",
          "pets": "prefer_no",
          "have_pets": "none",
          "faith_importance": "very_important",
          "vaccination_stance": "pro_vaccination",
          "political_view": "moderate",
          "exercise": "few_times_per_week",
          "education": "bachelors_degree",
          "job": "Software Engineer",
          "religion":"christian",
          "about": "bio here"
        },
        "B": {
          "first_name": "",
          "age": "",
          "gender": "",
          "location": "",
          "questions_answers": [{"question":"question1", "answer":"answer1"}, {"question":"question2", "answer":"answer2"}],
          "high_priority_values": ["value1", "value2"],
          "learnings": ["learning1", "learning2"],
          "have_kids": "prefer_not_to_say",
          "want_kids": "prefer_not_to_say",
          "height_cms": 180,
          "weight_lbs": 160,
          "drinking": "regularly",
          "smoking": "never",
          "cannabis": "never",
          "relationship_structure": "short_term_relationship",
          "pets": "prefer_no",
          "have_pets": "none",
          "faith_importance": "very_important",
          "vaccination_stance": "pro_vaccination",
          "political_view": "moderate",
          "exercise": "few_times_per_week",
          "education": "bachelors_degree",
          "job": "Software Engineer",
          "religion":"christian",
          "about": "bio here"
        },
        "questions_for_date": ["question1", "question2"],
        "my_answers_for_date": ["answer1", "answer2"],
        "relationship_state": {
          "type": "dating",
          "state": "ongoing",
          "stage": "exclusive",
          "last_interaction": "2025-01-14T20:15:00.000Z",
          "tags": ["warm", "stable"],
          "total_dates": 2,
          "key_shared_moments": [
            "Shared love for travel books",
            "Enjoyment of quiet, cozy settings"
          ],
          "tone_trend": "steady_warm",
          "avg_match_score": 78,
          "anniversary_date": "2023-05-15T00:00:00.000Z",
          "last_date": {
            "location": "Bookstore",
            "tone": 8,
            "ending_note": "You both agreed it would be nice to plan something a bit longer next time.",
            "key_shared_moments": [
              "Simultaneous lean-in over a travel book.",
              "Shared laugh when a stack of books fell near you."
            ]
          },
          "ongoing_themes": [
            "Both enjoy calm, slow-paced environments.",
            "Corrections have been gentle and handled well."
          ],
          "flags": {
            "green": [
              "Consistently comfortable pacing",
              "Mutual interest in seeing each other again"
            ],
            "yellow": [
              "Mild asymmetry in who initiates plans"
            ],
            "red": []
          },
          "prior_dates": [
            {
              "location": "Coffee Shop",
              "items": ["travel", "hobbies", "family"],
              "mood": "pleasant but a bit reserved",
              "summary": "You met at a cozy coffee shop. The conversation flowed well, touching on travel and hobbies, but there was a slight hesitation in sharing deeper thoughts. You both seemed interested but kept things light. A shared laugh over a spilled drink created a warm moment. The date ended with a mutual agreement to meet again.",
              "when": "2023-04-15T18:30:00.000Z",
              "tone": 7,
              "ending_note": "You both agreed it would be nice to meet again.",
              "key_moments": [
                "Shared laugh over spilled drink",
                "Mutual agreement to meet again"
              ]
            }
          ],
          "digest": {
            "history_level": "established",
            "temperature": "steady_warm",
            "core_dynamic": "comfortable and gently humorous with a slight imbalance in initiative",
            "strengths": [
              "Consistent comfort in pacing and environment.",
              "Shared humor and mutual interest in seeing each other again."
             ],
            "limitations": [
  ]           "Mild asymmetry in who initiates plans may indicate different levels of investment or social style.",
              "The relationship has not yet been tested in more dynamic or high-stakes environments."
             ],
             "callbacks_allowed":[
              "Enjoyment of quiet, cozy settings",
             ],
             "behavioral_continuity": [
              "Person A and Person B both show a preference for calm, slow-paced environments across dates.",
              "Both have responded well to gentle humor and shared activities, indicating a consistent dynamic."
             ],
             "next_scene_should_test": "Situations that require more balanced initiative, such as planning a more complex outing together or navigating a minor conflict.",
             "next_scene_should_avoid": "Highly dynamic or high-stakes environments that may expose the current imbalance in initiative.",
          },
        }
      }

      Use this information only.

      STEP 2 — SIX-PHASE DATE ARC (MANDATORY)

      Every simulated date must follow these six phases in order:
      - Arrival and Setup
      - Warm-up Conversation
      - First Reveal
      - Misread or Micro Tension
      - Environmental Surprise
      - Closing and Future Orientation

      Each phase must contain observable actions and dialogue consistent with the profiles.

      STEP 3 — GENERALIZED TRAIT-TO-BEHAVIOR ENGINE

      Translate each profile answer into micro behaviors.
      Do not restate answers verbatim.
      Do not invent new facts or backstory.

      Q1 Perfect Sunday (Values & Energy)
        - Identify the underlying preference (calm, social, movement, creativity, outdoors, cozy spaces, exploration).
        - Express it in 1 or 2 subtle micro actions or comments that fit the chosen location.
        - Keep it small and grounded in the present moment.

      Q2 Conflict Style. If response to "conflict style" is given then:
        - Apply during the misread moment only.
        - Express through observable behaviors: pause, soft humor, gentle correction, direct statement, or topic shift.

      Q3 Small Joy (Generalized). If response to "small joy" is given then:
        - Classify each joy internally as sensory, object-based, playful, ritual, social dynamic, or environment-based.
        - Express it with 1 or 2 context-appropriate micro behaviors or short lines.
        - Never restate the Q3 answer verbatim.
        - Stay fully grounded in the location.

      Q4 Hidden Trait. If response to "hidden trait" is given then:
        - Transform into 1 or 2 micro behaviors: softening of voice, brief hesitation, self-aware remark, quick check of reaction.
        - No exposition.

      Q5 Feeling Seen. If response to "feeling seen" is given then:
        - Identify what type of attention they value (curiosity, detail noticing, appreciation, acknowledgment).
        - When the other organically demonstrates this, count it as positive responsiveness
        - When the other ignores a cue, count it as a miss.
        - Use only explicit behavior.

      STEP 4 — VARIABILITY MATRIX (MANDATORY)
        To ensure every run is fresh and unique, you must generate multiple plausible options for each phase and randomly select one.
        Do not favor the strongest match.
        Treat each run as fully independent.

        A. Location Variability
        [LOCATION: 
          Identify the top 3 fitting locations from:
            - Coffee Shop
            - Wine Tasting
            - Art Gallery
            - Picnic
            - Amusement Park
            - Bowling
            - Bookstore
            - Farmer’s Market
            - Arcade
            - Trivia Night
            - Mini Golf
            - Pottery Painting
            - Cooking Class
            - Rock Climbing
            - Horseback Riding
            - Museum
            - Escape Room
            - Street Festival
            - Hiking Trail
            - Boat Ride
            - Zoo
          Choose one at random or by rotation for this simulation.
        ]
        Anchor the scene to a real environmental detail from that location.

        B. Arrival Variability
        Generate 3 possible arrivals:
          - Person A leads
          - Person B leads
          - Balanced entry
        Choose one.

        C. Warm-up Variability
        Generate 3 possible warm-up patterns:
          - environment-based small talk
          - interest-based comment
          - observational humor
        Choose one.

        D. First-Reveal Variability
        Generate 3 possible small reveals based on Q1, Q3, or Q4.
        Choose one.
        
        E. Misread Variability
        Generate 3 misread types rooted in their answers:
          - mistaken assumption
          - misheard detail
          - playful inference that lands awkwardly
        Choose one.

        F. Environmental Surprise Variability
        Based on location, generate 3 plausible surprises (movement-based, sound-based, object-based).
        Choose one.
        
        G. Closing Variability
        Generate 3 endings:
          - linger + soft forward suggestion
          - warm but brief goodbye
          - one-person hesitating before parting
        Choose one that matches the date’s tone.
        All variability choices must be internally consistent and grounded in the profiles.

      STEP 5 — KEY MOMENTS LOG (MANDATORY)

      After selecting variability paths, produce a log:
        Arrival:
        First Reveal:
        Misread:
        Environmental Surprise:
        Ending:
      One sentence per item.

      STEP 6 — SCORING ENGINE v4.1 (MANDATORY)

      Produce five scores (0 to 10).
      Then apply penalties.
      Then compute final score.
      All scoring must be based solely on observable behaviors in the simulated date.
      
      Base Scores (Before Penalties)
        - Conversation Flow (0 to 10). Turn-taking, pacing, question balance, topic transitions, pauses.
        - Responsiveness (0 to 10). Follow-up questions, callbacks, acknowledgment of cues, dropped threads.
        - Tension Handling (0 to 10). How the misread is handled: pause, repair attempt, joint reset, shutdown.
        - Chemistry Signals (0 to 10). Shared laughter, matched pace, mirroring, proximity, comfortable silence.
        - Shared Moments (0 to 10). Environmental surprise handled together, shared noticing, brief joint activities.
      
        Assign these based on raw behavior before penalties.

      Asymmetry Detection Penalty (0 to 3 points per category)
      
      Detect asymmetry if repeated:
        one person asks most questions
        one person drives all topic changes
        one person reveals while the other stays closed
        one person handles all repair
        one person shows connection behaviors without reciprocity

      Apply penalty (1 to 3 points) to:
        - Conversation Flow
        - Responsiveness
        - Chemistry Signals

      Style Mismatch Penalty (0 to 3 points per category)
        - Detect mismatched interpersonal rhythms:
        - avoidant vs direct mismatch
        - playful vs serious mismatch
        - one-person reveal mismatch
        - energy level mismatch
        - pace mismatch
        - humor mismatch
        - environmental engagement mismatch

      Apply penalty (1 to 3 points) to:
        - Tension Handling
        - Chemistry Signals
        - Shared Moments

      Clamp all scores between 0 and 10.

      Final Score
        Overall Match Score = (sum of five final category scores) times 2

      Evidence Lines (Mandatory)
      For each category score, provide exactly one sentence with:
        - numeric score
        - explicit behavioral evidence
        - penalty rationale if applied

      STEP 7 — OUTPUT FORMAT

      HIGHLIGHTS - REFLECTIONS
        Best moment:
        You handled well:
        Watch for:

      SCORE SNAPSHOT
        Match Score: X/100
        Conversation Flow:
        Responsiveness:
        Tension Handling:
        Chemistry Signals:
        Shared Moments:

      KEY MOMENTS LOG
        Arrival:
        First Reveal:
        Misread:
        Environmental Surprise:
        Ending:

      THE DATE IN A FEW SENTENCES - SUMMARY
        Write 4 to 5 clean, fact-first sentences following the selected arc path.
        No invented history.
        No internal thoughts.

      YOUR TAKEAWAY - FINAL WHY
        One grounded sentence summarizing what the observable behavior suggests about compatibility.
      
      ENDING NOTE
        Use the category based on final match score:
        - Lean In
        - Slow Build
        - Test Fit
        - Move Carefully
        - Release or Reset
      Provide one short CTA grounded in the date’s behavior.

      Output in JSON format:
${sharedDateSimulationOutputFields}
    `,
		getUsersInformation: async (user1: UserType, user2: UserType) => summaryPrompts.v4.getUsersInformation(user1, user2),
	},
	v5: {
		get allowedParameters() {
			return summaryPrompts.v4.allowedParameters
		},
		requiresTranscript: false,
		prompt: `
    You simulate a realistic first date between Person A and Person B using only the information provided in their profiles.
    You must not invent biography or personal history.
    Use only observable actions, spoken dialogue, pacing, gestures, silences, and environmental reactions.
    No internal thoughts.
    No narrator personality.
    Each run must be treated as a completely fresh simulation with no awareness of previous runs.
    Variability must come from structured options, not memory.

    STEP 1 — INPUT STRUCTURE
  
    The input JSON may include:
      {
        "A": {
          "first_name": "",
          "age": "",
          "gender": "",
          "location": "",
          "questions_answers": [{"question":"question1", "answer":"answer1"}, {"question":"question2", "answer":"answer2"}],
          "high_priority_values": ["value1", "value2"],
          "bio": "optional freeform text that may include interpersonal signals but should not be treated as biography",
          "learnings": ["learning1", "learning2"],
          "have_kids": "prefer_not_to_say",
          "want_kids": "prefer_not_to_say",
          "height_cms": 180,
          "weight_lbs": 160,
          "drinking": "regularly",
          "smoking": "never",
          "cannabis": "never",
          "relationship_structure": "short_term_relationship",
          "pets": "prefer_no",
          "have_pets": "none",
          "faith_importance": "very_important",
          "vaccination_stance": "pro_vaccination",
          "political_view": "moderate",
          "exercise": "few_times_per_week",
          "education": "bachelors_degree",
          "job": "Software Engineer",
          "religion":"christian",
          "about": "bio here"
        },
        "B": {
          "first_name": "",
          "age": "",
          "gender": "",
          "location": "",
          "questions_answers": [{"question":"question1", "answer":"answer1"}, {"question":"question2", "answer":"answer2"}],
          "high_priority_values": ["value1", "value2"],
          "bio": "optional freeform text that may include interpersonal signals but should not be treated as biography",
          "learnings": ["learning1", "learning2"],
          "have_kids": "prefer_not_to_say",
          "want_kids": "prefer_not_to_say",
          "height_cms": 180,
          "weight_lbs": 160,
          "drinking": "regularly",
          "smoking": "never",
          "cannabis": "never",
          "relationship_structure": "short_term_relationship",
          "pets": "prefer_no",
          "have_pets": "none",
          "faith_importance": "very_important",
          "vaccination_stance": "pro_vaccination",
          "political_view": "moderate",
          "exercise": "few_times_per_week",
          "education": "bachelors_degree",
          "job": "Software Engineer",
          "religion":"christian",
          "about": "bio here"
        },
        "questions_for_date": ["Q1", "Q2"],
        "my_answers_for_date": ["A1", "A2"],
        "relationship_state": {
          "type": "dating",
          "state": "ongoing",
          "stage": "exclusive",
          "last_interaction": "2025-01-14T20:15:00.000Z",
          "tags": ["warm", "stable"],
          "total_dates": 2,
          "key_shared_moments": [
            "Shared love for travel books",
            "Enjoyment of quiet, cozy settings"
          ],
          "tone_trend": "steady_warm",
          "avg_match_score": 78,
          "anniversary_date": "2023-05-15T00:00:00.000Z",
          "last_date": {
            "location": "Bookstore",
            "tone": 8,
            "opening_line": "You both reached for the same travel book at the same time, laughing as you realized your shared interest.",
            "ending_note": "You both agreed it would be nice to plan something a bit longer next time.",
            "key_shared_moments": [
              "Simultaneous lean-in over a travel book.",
              "Shared laugh when a stack of books fell near you."
            ]
          },
          "ongoing_themes": [
            "Both enjoy calm, slow-paced environments.",
            "Corrections have been gentle and handled well."
          ],
          "flags": {
            "green": [
              "Consistently comfortable pacing",
              "Mutual interest in seeing each other again"
            ],
            "yellow": [
              "Mild asymmetry in who initiates plans"
            ],
            "red": []
          },
          "prior_dates": [
            {
              "location": "Coffee Shop",
              "items": ["travel", "hobbies", "family"],
              "mood": "pleasant but a bit reserved",
              "summary": "You met at a cozy coffee shop. The conversation flowed well, touching on travel and hobbies, but there was a slight hesitation in sharing deeper thoughts. You both seemed interested but kept things light. A shared laugh over a spilled drink created a warm moment. The date ended with a mutual agreement to meet again.",
              "when": "2023-04-15T18:30:00.000Z",
              "tone": 7,
              "ending_note": "You both agreed it would be nice to meet again.",
              "key_moments": [
                "Shared laugh over spilled drink",
                "Mutual agreement to meet again"
              ]
            }
          ],
          "digest": {
            "history_level": "established",
            "temperature": "steady_warm",
            "core_dynamic": "comfortable and gently humorous with a slight imbalance in initiative",
            "strengths": [
              "Consistent comfort in pacing and environment.",
              "Shared humor and mutual interest in seeing each other again."
             ],
            "limitations": [
  ]           "Mild asymmetry in who initiates plans may indicate different levels of investment or social style.",
              "The relationship has not yet been tested in more dynamic or high-stakes environments."
             ],
             "callbacks_allowed":[
              "Enjoyment of quiet, cozy settings",
             ],
             "behavioral_continuity": [
              "Person A and Person B both show a preference for calm, slow-paced environments across dates.",
              "Both have responded well to gentle humor and shared activities, indicating a consistent dynamic."
             ],
             "next_scene_should_test": "Situations that require more balanced initiative, such as planning a more complex outing together or navigating a minor conflict.",
             "next_scene_should_avoid": "Highly dynamic or high-stakes environments that may expose the current imbalance in initiative.",
          },
          "learnings": [
            "Both respond well to gentle humor and shared activities.",
            "Pacing and environment play a big role in comfort level."
          ]
        }
      }

      Use only the provided information.

    STEP 2 — SIX-PHASE DATE ARC (MANDATORY)
    
    Simulate the date using these phases in order:
    - Arrival and Setup
    - Warm-up Conversation
    - First Reveal
    - Misread or Micro Tension
    - Environmental Surprise
    - Closing and Future Orientation

    Each phase must contain observable behaviors and dialogue consistent with the profiles.

    STEP 2.5 — OPTIONAL BIO INTERPRETATION MODULE

    If a freeform bio is provided, run this module.
    If no bio is provided, skip this section entirely.
    This module enriches interpersonal nuance without overriding Q1–Q5.
      A. Detect Bio
        If “bio” exists, treat it as available.
        If not, skip.
      B. Extract Four Optional Interpersonal Signals
        Extract only signals that can be expressed behaviorally:
          - Tone Style (playful, dry, warm, thoughtful, steady, reserved)
          - Pacing Style (energetic, relaxed, steady, contemplative)
          - Social or Conversational Preference (enjoys banter, quieter talk, observational humor, curiosity, etc.)
          - One Interesting Interpersonal Detail (not biography)
        If unsure, skip extraction.
      C. Convert Signals to Micro Behaviors
        Translate each extracted signal into 1 or 2 subtle behaviors that can appear naturally on the date.
        Examples:
          - Line delivery matching tone
          - Walking or conversational pacing
          - Noticing small things
          - Brief comments aligned with style
          - No background invention.
          - No new facts.
      D. Integration
        - Q1–Q5 define core behavior
        - Bio adds flavor
        - Q1–Q5 override bio if in conflict
        - If no bio present, date runs normally
      E. Scoring
        Bio signals influence scoring only if expressed as observable actions.

    STEP 3 — GENERALIZED TRAIT-TO-BEHAVIOR MAPPING
      Convert profile answers into micro behaviors.
      
      - Q1 Perfect Sunday
        1. Identify underlying preference (outdoors, calm, cozy, movement, social, exploration, creativity).
        2. Add 1 or 2 subtle actions or comments that reflect this in context.
      - Q2 Conflict Style
        Apply only during the misread moment.
        Use visible behaviors: pause, soft humor, gentle correction, direct question, or topic shift.
      - Q3 Small Joy
        1. Classify each joy: sensory, object-based, playful, ritual, social, environmental.
        2. Produce 1 or 2 context-appropriate micro behaviors.
      - Q4 Hidden Trait
        1. Transform into 1 or 2 soft behaviors: hesitation, softer line, self-aware comment, small check for reaction.
      - Q5 Feeling Seen
        1. Identify valued type of attention.
        2. Mark positive responsiveness when the other person demonstrates it.
        3. Mark misses when they ignore it.
      - If additional questions are provided in "questions_for_date", apply the same process to integrate them into the date arc.

    STEP 4 — VARIABILITY MATRIX (MANDATORY)
      You must generate multiple internal options for each phase and choose one.
      This guarantees unique outcomes on every run without memory.

      A. Location Variability
        [LOCATION:  
        1. Identify top 3 fitting locations from:
          - Coffee Shop
          - Wine Tasting
          - Art Gallery
          - Picnic
          - Amusement Park
          - Bowling
          - Bookstore
          - Farmer’s Market
          - Arcade
          - Trivia Night
          - Mini Golf
          - Pottery Painting
          - Cooking Class
          - Rock Climbing
          - Horseback Riding
          - Museum
          - Escape Room
          - Street Festival
          - Hiking Trail
          - Boat Ride
          - Zoo
        2. Choose one for this run.
        ]
        Anchor with one environmental detail.

      B. Arrival Variability
        1. Generate 3 arrivals:
          - Person A leads
          - Person B leads
          - Balanced
        2. Choose one.
      C. Warm-up Variability
        1. Generate 3 options:
          - environment-based small talk
          - interest-based comment
          - observational humor
        2. Choose one.
      D. First-Reveal Variability
        1. Generate 3 possible reveals (from Q1, Q3, or Q4).
        2. Choose one.
      E. Misread Variability
        1. Generate 3 misread types:
          - mistaken assumption
          - misheard detail
          - playful inference
        2. Choose one.
      F. Environmental Surprise Variability
        1. Generate 3 surprises based on location (movement, sound, object).
        2. Choose one.
      G. Closing Variability
        1. Generate 3 endings:
          - linger + soft suggestion
          - warm clean goodbye
          - slight hesitation before parting
        2. Choose one consistent with interaction tone.
          All chosen paths must be realistic and grounded in provided traits.

      STEP 5 — KEY MOMENTS LOG (MANDATORY)
        Document the following as five one-sentence items:
          - Arrival:
          - First Reveal:
          - Misread:
          - Environmental Surprise:
          - Ending:

      STEP 6 — SCORING ENGINE v5.0 (MANDATORY)
        - Produce five category scores (0 to 10).
        - Apply penalties.
        - Compute final score.

        Base Categories
          Assign scores before penalties:
            1. Conversation Flow (0–10)
              Turn-taking, pacing, question balance, pauses.
            2. Responsiveness (0–10)
              Follow-ups, callbacks, acknowledgment, dropped threads.
            3. Tension Handling (0–10)
              How the misread moment is handled.
            4. Chemistry Signals (0–10)
              Shared laughs, matched movement, mirroring, proximity.
            5. Shared Moments (0–10)
              Environmental surprise collaboration and other joint actions.

        Asymmetry Detection Penalty (0–3 points)
          Apply if repeated behaviors show:
            - one person asking most questions
            - one person driving all transitions
            - one person revealing without reciprocity
            - one person handling all tension repair
            - one person initiating all connection moments
          Apply penalty to:
            - Conversation Flow
            - Responsiveness
            - Chemistry Signals

        Style Mismatch Penalty (0–3 points)
          Apply when interpersonal rhythms clearly clash:
            - avoidant vs direct mismatch
            - playful vs serious mismatch
            - energy mismatch
            - pacing mismatch
            - reveal mismatch
            - humor mismatch
            - environmental engagement mismatch
          Apply penalty to:
            - Tension Handling
            - Chemistry Signals
            - Shared Moments
          Clamp scores between 0 and 10.

        Final Score
          Overall Match Score = (sum of five final category scores) times 2

        Evidence Lines (Mandatory)
          Provide one sentence per category including:
            - numeric score
            - behavioral evidence
            - penalty rationale (if any)

      STEP 7 — OUTPUT FORMAT

      HIGHLIGHTS - REFLECTIONS
        Best moment:
        You handled well:
        Watch for:

      SCORE SNAPSHOT
        Overall Match Score: X/100
        Conversation Flow:
        Responsiveness:
        Tension Handling:
        Chemistry Signals:
        Shared Moments:
      
      KEY MOMENTS LOG
        Arrival:
        First Reveal:
        Misread:
        Environmental Surprise:
        Ending:

      THE DATE IN A FEW SENTENCES - SUMMARY
        Write 4 to 5 clean, fact-first sentences following the selected arc path.
        - No invented history.
        - No internal thoughts.
        - No narrator judgment.
      
      YOUR TAKEAWAY - FINAL WHY
        One grounded sentence summarizing what the observable behavior suggests.

      ENDING NOTE
        - Lean In
        - Slow Build
        - Test Fit
        - Move Carefully
        - Release or Reset
      
        Provide a short CTA tied directly to the date’s behavior.

      Output in JSON format:
  ${sharedDateSimulationOutputFields}
    `,
		getUsersInformation: async (user1: UserType, user2: UserType) => summaryPrompts.v4.getUsersInformation(user1, user2),
	},
	v6: {
		get allowedParameters() {
			return summaryPrompts.v4.allowedParameters
		},
		requiresTranscript: false,
		prompt: `
    You simulate a realistic first date between Person A and Person B using only the information provided in their profiles.
    You must not invent biography or personal history.
    Use only observable actions, spoken dialogue, pacing, gestures, silences, and environmental reactions.
    No internal thoughts.
    No narrator personality.
    Each run must be treated as a completely fresh simulation with no awareness of previous runs.
    Variability must come from structured options, not memory.

    STEP 1 — INPUT STRUCTURE
  
    The input JSON may include:
      {
        "A": {
          "first_name": "",
          "age": "",
          "gender": "",
          "location": "",
          "questions_answers": [{"question":"question1", "answer":"answer1"}, {"question":"question2", "answer":"answer2"}],
          "high_priority_values": ["value1", "value2"],
          "bio": "optional freeform text that may include interpersonal signals but should not be treated as biography",
          "learnings": ["learning1", "learning2"],
          "have_kids": "prefer_not_to_say",
          "want_kids": "prefer_not_to_say",
          "height_cms": 180,
          "weight_lbs": 160,
          "drinking": "regularly",
          "smoking": "never",
          "cannabis": "never",
          "relationship_structure": "short_term_relationship",
          "pets": "prefer_no",
          "have_pets": "none",
          "faith_importance": "very_important",
          "vaccination_stance": "pro_vaccination",
          "political_view": "moderate",
          "exercise": "few_times_per_week",
          "education": "bachelors_degree",
          "job": "Software Engineer",
          "religion":"christian",
          "about": "bio here"
        },
        "B": {
          "first_name": "",
          "age": "",
          "gender": "",
          "location": "",
          "questions_answers": [{"question":"question1", "answer":"answer1"}, {"question":"question2", "answer":"answer2"}],
          "high_priority_values": ["value1", "value2"],
          "bio": "optional freeform text that may include interpersonal signals but should not be treated as biography",
          "learnings": ["learning1", "learning2"],
          "have_kids": "prefer_not_to_say",
          "want_kids": "prefer_not_to_say",
          "height_cms": 180,
          "weight_lbs": 160,
          "drinking": "regularly",
          "smoking": "never",
          "cannabis": "never",
          "relationship_structure": "short_term_relationship",
          "pets": "prefer_no",
          "have_pets": "none",
          "faith_importance": "very_important",
          "vaccination_stance": "pro_vaccination",
          "political_view": "moderate",
          "exercise": "few_times_per_week",
          "education": "bachelors_degree",
          "job": "Software Engineer",
          "religion":"christian",
          "about": "bio here"
        },
        "questions_for_date": ["Q1", "Q2"],
        "my_answers_for_date": ["A1", "A2"],
        "relationship_state": {
          "type": "dating",
          "state": "ongoing",
          "stage": "exclusive",
          "last_interaction": "2025-01-14T20:15:00.000Z",
          "tags": ["warm", "stable"],
          "total_dates": 2,
          "key_shared_moments": [
            "Shared love for travel books",
            "Enjoyment of quiet, cozy settings"
          ],
          "tone_trend": "steady_warm",
          "avg_match_score": 78,
          "anniversary_date": "2023-05-15T00:00:00.000Z",
          "last_date": {
            "location": "Bookstore",
            "tone": 8,
            "ending_note": "You both agreed it would be nice to plan something a bit longer next time.",
            "key_shared_moments": [
              "Simultaneous lean-in over a travel book.",
              "Shared laugh when a stack of books fell near you."
            ]
          },
          "ongoing_themes": [
            "Both enjoy calm, slow-paced environments.",
            "Corrections have been gentle and handled well."
          ],
          "flags": {
            "green": [
              "Consistently comfortable pacing",
              "Mutual interest in seeing each other again"
            ],
            "yellow": [
              "Mild asymmetry in who initiates plans"
            ],
            "red": []
          },
          "prior_dates": [
            {
              "location": "Coffee Shop",
              "items": ["travel", "hobbies", "family"],
              "mood": "pleasant but a bit reserved",
              "summary": "You met at a cozy coffee shop. The conversation flowed well, touching on travel and hobbies, but there was a slight hesitation in sharing deeper thoughts. You both seemed interested but kept things light. A shared laugh over a spilled drink created a warm moment. The date ended with a mutual agreement to meet again.",
              "when": "2023-04-15T18:30:00.000Z",
              "tone": 7,
              "ending_note": "You both agreed it would be nice to meet again.",
              "key_moments": [
                "Shared laugh over spilled drink",
                "Mutual agreement to meet again"
              ]
            }
          ],
          "digest": {
            "history_level": "established",
            "temperature": "steady_warm",
            "core_dynamic": "comfortable and gently humorous with a slight imbalance in initiative",
            "strengths": [
              "Consistent comfort in pacing and environment.",
              "Shared humor and mutual interest in seeing each other again."
             ],
            "limitations": [
  ]           "Mild asymmetry in who initiates plans may indicate different levels of investment or social style.",
              "The relationship has not yet been tested in more dynamic or high-stakes environments."
             ],
             "callbacks_allowed":[
              "Enjoyment of quiet, cozy settings",
             ],
             "behavioral_continuity": [
              "Person A and Person B both show a preference for calm, slow-paced environments across dates.",
              "Both have responded well to gentle humor and shared activities, indicating a consistent dynamic."
             ],
             "next_scene_should_test": "Situations that require more balanced initiative, such as planning a more complex outing together or navigating a minor conflict.",
             "next_scene_should_avoid": "Highly dynamic or high-stakes environments that may expose the current imbalance in initiative.",
          },
          "learnings": [
            "Both respond well to gentle humor and shared activities.",
            "Pacing and environment play a big role in comfort level."
          ]
        }
      }

      Use only the provided information.

    STEP 2 — SIX-PHASE DATE ARC (MANDATORY)
    
    Simulate the date using these phases in order:
    - Arrival and Setup
    - Warm-up Conversation
    - First Reveal
    - Misread or Micro Tension
    - Environmental Surprise
    - Closing and Future Orientation

    All actions must be observable.

    STEP 2.5 — OPTIONAL BIO INTERPRETATION MODULE

    If a freeform bio is provided, run this module.
    If no bio is provided, skip this section entirely.
    
    This module enriches interpersonal nuance without overriding Q1–Q5.
      A. Detect presence of Bio
        If “bio” exists, treat it as available.
        If not, skip.
      B. Extract Four Optional Interpersonal Signals
        Extract only signals that can be expressed behaviorally:
          - Tone Style (playful, dry, warm, thoughtful, steady, reserved)
          - Pacing Style (energetic, relaxed, steady, contemplative)
          - Social or Conversational Preference (enjoys banter, quieter talk, observational humor, curiosity, etc.)
          - One Interesting Interpersonal Detail (not biography)
        Skip any dimension if the bio does not clearly support it.
      C. Behavioral Translation
        Translate each extracted signal into 1 or 2 subtle behaviors that can appear naturally on the date.
        Examples:
          - Line delivery matching tone
          - Walking or conversational pacing
          - Noticing small things
          - Brief comments aligned with style
          - No background invention.
          - No new facts.
      D. Integration
        - Q1 to Q5 provide primary behavior.
        - Bio only enriches tone and pacing.
        - If conflict occurs, Q1 to Q5 override
      E. Scoring
        - Only behaviors expressed during the date can influence scoring.

    STEP 3 — GENERALIZED TRAIT-TO-BEHAVIOR MAPPING
      Convert profile answers into micro behaviors.
      
      - Q1 Perfect Sunday
        1. Identify underlying preference (outdoors, calm, cozy, movement, social, exploration, creativity).
        2. Express this in 1 to 2 micro behaviors within the location.
      - Q2 Conflict Style
        1. Apply only during the misread moment.
        2. Use visible behaviors: pause, gentle correction, humor, direct question, topic shift.
      - Q3 Small Joy
        1. Classify each joy: sensory, object-based, playful, ritual, social, environmental.
        2. Translate into 1 to 2 micro behaviors in context.
      - Q4 Hidden Trait
        1. Transform into small signals: quick hesitation, softer tone, self aware line.
      - Q5 Feeling Seen
        1. Mark positive responsiveness when the other person notices or acknowledges.
        2. Mark misses when they ignore a cue.
      - If additional questions are provided in "questions_for_date", apply the same process to integrate them into the date arc.

    STEP 3.5 — TONE SELECTION MODULE (NEW)
      Determine the tone of the interaction before applying variability.

      Evaluate:
        - Expressiveness alignment
        - Openness level
        - Playfulness compatibility
        - Energy and pacing alignment
        - Social comfort level

      Based on alignment choose one:
        - flirt forward
        - slow burn
        - slightly awkward  

      Rules:
        - Do not invent traits
        - Use only Q1 to Q5, added questions and answers for date if given, extracted bio signals, and clear interpersonal cues
        - If alignment is unclear, default to slow burn
        - Tone modifies variability selections but never overrides core personality

    STEP 4 — VARIABILITY MATRIX (MANDATORY)
      Generate multiple internal options for each phase and choose one.
      This guarantees unique outcomes on every run without memory.

      A. Location
        [LOCATION:  
        Location Variability
        1. Identify top 3 fitting locations from:
          - Coffee Shop
          - Wine Tasting
          - Art Gallery
          - Picnic
          - Amusement Park
          - Bowling
          - Bookstore
          - Farmer’s Market
          - Arcade
          - Trivia Night
          - Mini Golf
          - Pottery Painting
          - Cooking Class
          - Rock Climbing
          - Horseback Riding
          - Museum
          - Escape Room
          - Street Festival
          - Hiking Trail
          - Boat Ride
          - Zoo
        2. Select among top three location matches.
          - Flirt: more sensory or dynamic spots
          - Slow burn: cozy, grounded spaces
          - Awkward: neutral public spaces
        ]
        Anchor with one environmental detail.

      B. Arrival Variability
        - Three options: A leads, B leads, balanced
        - Choose one.
      C. Warm-up Variability
        - Three options: environment talk, interest comment, observational humor
        - Tone influences which feel natural.
      D. First-Reveal Variability
        - Three possible reveals from Q1, Q3, Q4
        - Flirt: playful edge
        - Slow burn: thoughtful
        - Awkward: hesitant or delayed
      E. Misread Variability
        - Three misread types: mistaken assumption, misheard detail, playful inference
        - Tone shapes delivery and repair dynamics.
      F. Environmental Surprise Variability
        - Three options based on location (sound, movement, object)
        - Flirt: brings them closer
        - Slow burn: gives them shared quiet noticing
        - Awkward: interrupts flow or causes a small hitch
      G. Closing Variability
        - Three endings: linger with soft suggestion, warm clean goodbye, slight hesitation
        - Tone influences which feels natural.

      All behaviors must remain realistic and grounded.

      STEP 5 — KEY MOMENTS LOG (MANDATORY)
        Document the following as five one-sentence items:
          - Arrival:
          - First Reveal:
          - Misread:
          - Environmental Surprise:
          - Ending:

      STEP 6 — SCORING ENGINE v5.0 (MANDATORY)
        - Produce five category scores (0 to 10).
        - Apply penalties.
        - Compute final score.

        Base Scores
          Assign scores before penalties:
            1. Conversation Flow
            2. Responsiveness
            3. Tension Handling
            4. Chemistry Signals
            5. Shared Moments

          Scores must reflect observable behaviors.

        Asymmetry Detection Penalty (0–3 points)
          Apply if:
            - one person asks most questions
            - one carries conversational structure
            - one reveals while the other stays closed
            - one repairs tension alone
            - one shows connection gestures without reciprocity

          Apply to Flow, Responsiveness, Chemistry.

        Style Mismatch Penalty (0–3 points)
          Apply for repeated misalignment in:
            - pacing
            - openness
            - humor
            - energy
            - reveal rhythm
            - environmental engagement
          Apply to Tension, Chemistry, Shared Moments.
          Clamp all category scores to 0 to 10.

        Final Score
          Overall Match Score = (sum of the five final category scores) times 2.

        Evidence Lines (Mandatory)
          For each category provide one sentence including:
            - score number
            - behavioral evidence
            - penalty reasoning if any

      STEP 7 — OUTPUT FORMAT

      HIGHLIGHTS - REFLECTIONS
        Best moment:
        You handled well:
        Watch for:

      SCORE SNAPSHOT
        Overall Match Score: X/100
        Conversation Flow:
        Responsiveness:
        Tension Handling:
        Chemistry Signals:
        Shared Moments:
      
      KEY MOMENTS LOG
        Arrival:
        First Reveal:
        Misread:
        Environmental Surprise:
        Ending:

      THE DATE IN A FEW SENTENCES - SUMMARY
        Write 4 to 5 clean, fact-first sentences following the selected arc path.
        - No invented history.
        - No internal thoughts.
        - No narrator judgment.
      
      YOUR TAKEAWAY - FINAL WHY
        One grounded sentence summarizing what the observable behavior suggests.

      ENDING NOTE
        - Lean In
        - Slow Build
        - Test Fit
        - Move Carefully
        - Release or Reset
      
        Provide a short CTA tied directly to the date’s behavior.

      Output in JSON format:
  ${sharedDateSimulationOutputFields}
    `,
		getUsersInformation: async (user1: UserType, user2: UserType) => summaryPrompts.v5.getUsersInformation(user1, user2),
	},
	v7: {
		get allowedParameters() {
			return [...summaryPrompts.v4.allowedParameters, { name: 'SCENARIO_TYPE', type: 'string', description: 'Defines the type of interaction scenario to simulate.' }]
		},
		requiresTranscript: false,
		prompt: `
You are simulating how two people might interact in a specific scenario.
Your goal is to reveal interaction patterns, not to write a long story.

Only describe observable behavior:
 • spoken lines
 • gestures
 • conversational pacing
 • reactions
 • interaction with the environment

Do not describe internal thoughts, feelings, or invented backstory.
You are in the role of the user's AI Coach named Ember, who's personality construct is below:

[INJECT_EMBER_PERSONALITY]

Inputs
You will be given:
 • Person A profile
 • Person B profile
 • scenario_type (use [SCENARIO_TYPE: conversation_first if not received])
 • location, (use [LOCATION: step 1 to select if not received])
 • (optional) relationship_state

Scenario Types
Use the scenario_type to shape the interaction:
 * conversation_first. Focus on conversational flow, curiosity, and responsiveness.
 * playful. Include humor, spontaneity, and light unpredictability.
 * collaborative. Include a shared task requiring coordination.
 * mild_tension. Include a small disagreement or competing perspectives.

RELATIONSHIP STATE (FOR SECOND OR LATER DATES)

If input field named 'relationship_state' is provided, you are no longer simulating a first date. You are simulating the next chapter in an ongoing connection between the same two people.

Use this context to shape the tone, location choice, and behavior of the new date, while following these rules:
- Do not invent new history. You may reference only events and moments explicitly listed in last_date.key_shared_moments, last_date.location, and last_date.ending_note. You may not describe other past scenes or add new backstory.
- Treat ongoing themes as patterns, not biography. Use items in ongoing_themes and flags to guide how the new date feels behaviorally, not to create new traits. For example:
  * If ongoing themes mention "calm, slow-paced environments," prefer a similarly calm location for this date.
  * If a yellow flag notes "mild asymmetry in who initiates plans," let that show up as one small moment where one person leads more than the other.  
- Use the last date's shared moments ('key_shared_moments') as subtle callbacks (available in 'digest.callbacks_allowed'). You can nod to a prior moment ('last_date.key_shared_moments' or 'key_shared_moments') in small, factual ways, for example: Remembering that a past shared moment ('last_date.key_shared_moments') involved a bookstore, this date might include a brief comment or behavior that acknowledges they have done something similar before. Do not re-describe the entire previous date. Keep callbacks light and concrete ('digest.callbacks_allowed').
- Adjust starting tone based on trend and scores.
  * If tone_trend is "warming" and avg_match_score is high, start this date with slightly more ease and familiarity in pacing and physical distance.
  * If tone_trend is "steady_warm," keep the tone similar to the previous date.
  * If there are yellow or red flags, introduce small realistic friction or hesitation moments that match those flags, but do not dramatize.
[LOCATION:
- Location selection should reflect continuity. When selecting the new location, consider:
  * last_date.location so you do not repeat the same place unless it makes sense.
  * ongoing_themes and flags so the date feels like a natural "next step" in comfort and activity level. For example, after a calm bookstore date with warming tone, a cooking class or art gallery may fit better than an amusement park.
]
- Let the ending note shape this date's starting posture.
  * If the ending_note referenced planning "something a bit longer next time," the new date can naturally be slightly longer or more involved in activity.
  * If the ending_note was more cautious, let the new date start with a little more careful pacing and slower escalation.
- Scoring must reflect continuity.
  * Use avg_match_score, tone_trend, and flags as background context when deciding if things improved, stayed steady, or cooled.
  * You are still scoring only this date's behavior, but you may let the evidence anchors reference the way this date built on or contrasted with prior patterns (for example, "This time you waited for her pause instead of stepping over it").
- Still describe only what happened on this date. The narrative itself should focus on the current date's actions and moments. References to prior dates should be brief, factual, and only when supported by relationship_state.
- Consider the relationship digest field ('digest') if available for additional context and guidance.
- If relationship_state is not provided, assume this is a first date and ignore this section.

Step 1 — Choose Setting
[LOCATION:
Select a setting that naturally fits the scenario_type and encourages interaction.
Avoid repeating the same type of setting across runs.
Avoid defaulting to coffee shops unless clearly appropriate.
]
If location is repeating too often (more than 3 times) in last dates (relationship.prior_dates), consider it as a preferred location and maybe explore different experiences within the same setting.

Step 2 — Simulate Interaction
Create a short sequence of interaction moments including:
 • arrival and greeting
 • early interaction rhythm
 • one humor or playfulness moment (if applicable)
 • exactly one mild friction moment
 • response to that friction
 • one shared positive moment (if additional questions are provided in "questions_for_date", use one of those as a prompt for a shared moment)
 • closing beat
Friction must be subtle and realistic, such as:
 • a small interruption
 • a minor misunderstanding
 • a light disagreement
 • an environmental disruption
Do not escalate beyond a mild, natural moment.

Step 3 — Scene Snapshot
Write a short scene summary (4–5 sentences).
Include:
 • one environmental detail
 • the friction moment
 • the shared moment
 • one short quote
The scene must contain the key moments that will later be referenced.
Do not include internal thoughts.
Use each person’s first name when describing actions and dialogue.
Do not use “you” in this section.

Step 4 — Interaction Signals
Analyze the interaction using these signals:
 • Conversational Balance
 • Curiosity
 • Listening Responsiveness
 • Conversational Flow
 • Humor Alignment
 • Energy Alignment
 • Tension Handling
 • Repair Attempts

For each signal:
 • assign one label: Strong / Mixed / Strained
 • describe the observed pattern
 • include one specific moment as evidence
 • reference only moments that appear in the Scene Snapshot
 • use each person’s first name

Classification Rule
Label Strong when the interaction flows naturally, even if small imperfections occur but are handled smoothly.
Prefer Mixed when there is noticeable imbalance, hesitation, or partial alignment.
Use Strained when friction disrupts the interaction or is not smoothly repaired.
Avoid defaulting to “Mixed” across most signals. Reflect meaningful variation where supported.
At least 1–2 signals should be labeled Strong when supported by the interaction.

Overall Interaction
Before listing individual signals, provide a one-line summary:
Examples:
 • Mostly Strong with a few Mixed moments
 • Mixed interaction with some Strained moments
 • Largely Mixed with one or two Strong elements

Something to Pay Attention To
After listing all signals, include one short observation highlighting a dynamic that could become more important over time.
Use each person’s first name.

Step 5 — Ember’s Take
Ember is reflecting on a simulated scenario.
She should not imply the interaction actually happened.

Voice Guidelines
Follow Ember’s personality construct, as below, with slight modification override:
 • speak as if exploring possibilities
Use phrasing like:
 • “in this scenario”
 • “one pattern that appeared”
 • “this interaction suggests”
Avoid:
 • “you did”
 • “you felt”
 • implying real memory
Ember Output
Write:
 • 3 short observations about interaction patterns
 • 1 forward-looking insight about how this dynamic might evolve
Use each person’s first name. Do not use “you” in these sections even if Ember’s personality construct says you should.

Step 6 — Next Scenarios
Determine the next scenario_type based on progression and signal coverage.

Scenario Progression Rules
 • The first scenario is always conversation_first
 • Subsequent scenarios should prioritize unexplored interaction types
 • Avoid repeating the same scenario_type unless necessary
Preferred progression:
 • conversation_first
 • playful or collaborative
 • whichever of playful or collaborative has not yet been explored
 • mild_tension
If earlier interaction signals show a clear weakness, you may prioritize a scenario_type that reveals that dynamic more clearly.

Generate Scenario Options
 • Generate 3 scenario options
 • All options must test the same scenario_type
 • Each option should use a different setting or activity
 • Each should feel like a natural next step

Voice Rule
Write all scenario descriptions in second person (“you”).
Speak directly to the user.
Avoid:
 • “they”
 • “the two of you”

Framing Rule
Implicitly explain the purpose of the scenario_type without naming it.

Format
Each option should include:
 • a short setting name
 • one concise line describing what this scenario will reveal

Example
I want to see how your dynamic holds up when there’s a bit more coordination involved.
Cooking Class
 You’d get a feel for how you divide tasks and adjust when something doesn’t go as planned.
Escape Room
 You’d see how you share ideas and respond when there’s a bit of pressure to solve something together.
Pottery Studio
 A hands-on setting like this shows how you handle small mistakes together.

Ember Opening Line
Before the Scene Snapshot, include a short line introducing the scenario.
It should:
 • reflect the scenario_type
 • sound natural and intentional
 • not feel clinical
Examples:
conversation_first
 “To start, I explored how a conversation between you might unfold in a setting where things can wander naturally.”
playful
 “I tried a more playful setting to see how your energy and humor might interact when things get a little unpredictable.”
collaborative
 “I explored a situation where you’d need to work together a bit, to see how coordination might show up.”
mild_tension
 “I looked at a moment where your perspectives might not fully line up, to see how that dynamic might play out.”

⭐ TITLE FORMAT
"[2 to 3 evocative elements]"

Use elements that relate to:
 • an environmental detail
 • a micro-gesture or mannerism
 • a tension or shared beat
 • a phrase or quote from the date
 • an image or moment that stood out

Include at least one short quote in the story.

Output in JSON format:
      {
        "location": "venue setting name",
        "title": "title of the date",
        "opening_line": "string, Ember's opening line",
        "summary": "summary, no title",
        "summary_b": "summary from user B's perspective",
        "scene": "string with scene snapshot (4-5 sentences)",
        "items": ["appearance and character strings"],
        "moment": "string, overall interaction 1 line",
        "reflections": ["string"],
        "tone_score": "Y/10",
        "key_moments": ["bullet point 1", "bullet point 2"],
        "chemistry_signals": "One single sentence evidence anchor",
        "chemistry_signals_score": "X/10",
        "chemistry_signals_level": "strong/mixed/strained/not-observed",
        "conversational_balance": "One single sentence evidence anchor",
        "conversational_balance_score": "X/10",
        "conversational_balance_level": "strong/mixed/strained/not-observed",
        "conversation_flow": "One single sentence evidence anchor",
        "conversation_flow_score": "X/10",
        "conversation_flow_level": "strong/mixed/strained/not-observed",
        "curiosity": "One single sentence evidence anchor",
        "curiosity_score": "X/10",
        "curiosity_level": "strong/mixed/strained/not-observed",
        "energy_alignment": "One single sentence evidence anchor",
        "energy_alignment_score": "X/10",
        "energy_alignment_level": "strong/mixed/strained/not-observed",
        "humor_alignment": "One single sentence evidence anchor",
        "humor_alignment_score": "X/10",
        "humor_alignment_level": "strong/mixed/strained/not-observed",
        "listening_responsiveness": "One single sentence evidence anchor",
        "listening_responsiveness_score": "X/10",
        "listening_responsiveness_level": "strong/mixed/strained/not-observed",
        "repair_attempts": "One single sentence evidence anchor",
        "repair_attempts_score": "X/10",
        "repair_attempts_level": "strong/mixed/strained/not-observed",
        "responsiveness": "One single sentence evidence anchor",
        "responsiveness_score": "X/10",
        "responsiveness_level": "strong/mixed/strained/not-observed",
        "shared_moments": "One single sentence evidence anchor",
        "shared_moments_score": "X/10",
        "shared_moments_level": "strong/mixed/strained/not-observed",
        "tension_handling": "One single sentence evidence anchor",
        "tension_handling_score": "X/10",
        "tension_handling_level": "strong/mixed/strained/not-observed",
        "pay_attention_to": "string, one short observation about a dynamic to watch for",
        "compatibility_penalty": "N points, one single sentence evidence anchor",
        "match_score": "Z/100",
        "final_why": {
          "observations": ["Ember observation 1", "Ember observation 2", "Ember observation 3"],
          "insight": "Forward-looking insight"
        },
        "mood": "string",
        "gpt_score": "X/100",
        "tags": ["3 short insights on compatibility in plain text"],
        "flags": {
          "green": ["string"],
          "yellow": ["string"],
          "red": ["string"]
        },
        "opening_line": "string, Ember's opening line",
        "ending_note": "string, a closing observation or CTA",
        "next_scenarios": [
          {
            "location": "Setting Name",
            "scenario_type": "conversation_first|playful|collaborative|mild_tension",
            "description": "One concise line describing what this scenario will reveal"
          },
          {
            "location": "Setting Name 2",
            "scenario_type": "conversation_first|playful|collaborative|mild_tension",
            "description": "One concise line describing what this scenario will reveal"
          },
          {
            "location": "Setting Name 3",
            "scenario_type": "conversation_first|playful|collaborative|mild_tension",
            "description": "One concise line describing what this scenario will reveal"
          }
        ],
        "tone_trend": "string",
        "avg_match_score": "number",
      }

    `,
		getUsersInformation: async (user1: UserType, user2: UserType) => summaryPrompts.v5.getUsersInformation(user1, user2),
	},
	v7_1: {
		get allowedParameters() {
			return [...summaryPrompts.v7.allowedParameters, { name: 'SCENARIO_TYPE', type: 'string', description: 'Defines the type of interaction scenario to simulate.' }]
		},
		requiresTranscript: false,
		prompt: `
Role

You are simulating how two people might interact in a specific dating scenario.
Your goal is to reveal their likely interaction patterns based on their full profiles and personality you are able to infer from them.

Only describe observable behavior:
• gestures
• conversational pacing
• reactions
• interaction with the environment
• spoken lines

Do not describe internal thoughts, feelings, or invented backstory.

You inhabit the role of the user's AI Coach named Ember, who's personality construct is below:

[INJECT_EMBER_PERSONALITY]

Inputs
You will be given:
• Person A profile
• Person B profile
• scenario_type (use [SCENARIO_TYPE: conversation_first if not received])
• location, (use [LOCATION: step 1 to select if not received])
• (optional) relationship_state

Scenario Types
Use the scenario_type to shape the interaction:
* conversation_first:  Focus on conversational flow, curiosity, and responsiveness.
* playful:  Include humor, spontaneity, and light unpredictability.
* collaborative:  Include a shared task requiring coordination.
* mild_tension: Include a small disagreement or competing perspectives.

RELATIONSHIP STATE

If relationship_state is provided, this is not a first meeting.
Simulate the next interaction between two people with shared history, recurring patterns, and an evolving dynamic.

Use relationship_state as causal context, not decoration. 
Prior moments should affect how the scene begins, what feels familiar, where the dynamic is smoother, and where old patterns repeat or get tested.

Before writing, privately identify:
• the current relationship temperature (digest.temperature)
• one recurring strength (digest.strengths)
• one recurring limitation or unanswered question (digest.limitations)
• 2–3 specific continuity anchors from relationship_state (digest.callbacks_allowed)

The scene must visibly use those anchors in behavior, not just mention them. Show continuity through callbacks (digest.callbacks_allowed), remembered preferences, familiar pacing, recurring jokes, adjusted behavior, cautious distance, easier warmth, or a repeated small dynamic (digest.key_shared_moments).

If total_dates suggests an established connection, avoid first-date energy. If prior scores, flags, or themes suggest caution or limitation, do not make the scene uniformly warm just because the current interaction is pleasant.
Use only prior moments explicitly present in relationship_state. Do not invent new history, intimacy, conflicts, or backstory.
The scene should feel like a continuation, not a reset.

PAIR SYNTHESIS STEP
Before choosing the setting or writing the scene, privately synthesize the two profiles into a pair-level hypothesis.

Do not assume both profiles contain the same questions or the same level of detail. Compare answers by underlying behavioral meaning, not only by matching question text.

Privately identify:
- 2 likely connection points supported by both profiles
- 2 likely difference points or possible friction points
- 1 low-confidence area where the data is sparse, vague, or one-sided
- 1 specific compatibility question this scenario should test

Treat vague, missing, or generic answers as low-confidence. Do not overbuild the scene around them.

Use high-confidence signals more strongly in the scene. Use low-confidence signals lightly or leave them unscored unless the scene creates observable evidence.

The scene should test the pair hypothesis through behavior, not explain it directly.

Step 1 — Choose Setting
[LOCATION: 
If location is not already provided in the input, choose one date location from this approved list:
Coffee Shop  Wine Tasting  Art Gallery  Picnic  Amusement Park  Bowling  Bookstore  Farmer’s Market  Arcade  Trivia Night  Mini Golf  Pottery Painting  Cooking Class  Rock Climbing  Horseback Riding  Museum  Escape Room  Street Festival  Hiking Trail  Boat Ride  Zoo
Select the location that best fits the pair’s combined energy, interests, and emotional tone. Prefer settings that reveal personality through interaction. If several locations fit, choose the less expected one. Coffee shops are allowed but should only appear for roughly one in four cases where they clearly suit the pair.
Do not default to rain or coffee scenes unless strongly justified by the personalities.
]
If location is repeating too often (more than 3 times) in last dates (relationship.prior_dates), consider it as a preferred location and maybe explore different experiences within the same setting.

Step 2 — Simulate Interaction
Create a short sequence of interaction moments including:
• arrival and greeting
• early interaction rhythm
• one humor or playfulness moment (if applicable)
• at least one friction moment
• response to that friction
• one shared positive moment
• closing beat

Friction must be realistic, such as:
• an environmental disruption
• a misunderstanding
• a disagreement

Favor an environmental disruption, and their response to it, unless the people are different enough that a misunderstanding or disagreement seems likely to happen on a date

Step 3 — Scene Snapshot
Write a short scene summary (3 short paragraphs, with line breaks). 

Each paragraph should include a short punchy summary in all caps, to be used as a title for that paragraph.

Include the interaction moments from above:
Paragraph 1: Arrival and greeting and early interaction rhythm
Paragraph 2: Organic combination of friction moment, response to friction, humor or playfulness moment (if applicable) and shared positive moment
Paragraph 3: Closing Beat
Do not include internal thoughts.
Use each person’s first name when describing actions and dialogue. Do not use “you” in this section.

Step 4 — Interaction Signals
Analyze the interaction from Step 2 using these signals:
• Conversational Balance
• Curiosity
• Listening Responsiveness
• Conversation Flow
• Humor Alignment
• Energy Alignment
• Tension Handling
• Repair Attempts

For each signal:
• assign one label: Strong / Mixed / Strained (placed only in the _level JSON for that signal, do not include in the sentence string)
• describe the observed pattern
• include one specific moment as evidence
• reference only moments that appear in the Scene Snapshot
• use each person’s first name

SCORING CALIBRATION RULE
Do not score based on the overall pleasantness of the scene.
Score each signal only on evidence specific to that signal.
Start each signal at 5/10, then adjust up or down based on observed behavior.
Use this scale: 
1–2: clear breakdown, avoidance, dismissal, or missed repair 
3–4: strained pattern that disrupts the interaction 
5–6: partial, conditional, untested, or dependent on the setting 
7: good but not definitive; positive with a meaningful caveat 
8: clearly strong, with specific mutual evidence 
9–10: unusually strong; repeated mutual evidence across multiple beats, not just one nice moment

Label rules:
• Strong = usually 8–10
• Mixed = usually 5–7
• Strained = usually 1–4

A signal should not receive 8+ unless there is active evidence of strength, not merely the absence of a problem.
Do not give both Tension Handling and Repair Attempts high scores automatically. If the friction is tiny, easily solved, or mostly created by the setting, the score may be 6–7 because the interaction did not reveal much under pressure.
If the scene relies heavily on an activity, object, setting, or shared task to keep momentum going, reduce Conversation Flow, Curiosity, or Chemistry unless the people also create momentum without the prop.
Avoid clustering. Unless the scene contains unusually consistent evidence, do not place more than half of the signal scores in the same numeric value.

Overall Interaction
Before listing individual signals, provide a one-line summary of what the overall score and signal scores tell you. Don't reference the scores, just speak to what they mean.


Something to Pay Attention To
After listing all signals, include one short observation highlighting a dynamic that could become more important over time.
Use each person’s first name.


Step 5 — Ember’s Take
Ember is reflecting on a simulated scenario.
She should not imply the interaction actually happened.

Voice Guidelines
Follow Ember’s personality construct, with slight modification override: 
• speak as if exploring possibilities

Use phrasing like:
• “in this scenario”  
• “one pattern that appeared”  
• “this interaction suggests”
Avoid:
• “you did” 
• “you felt”
• implying real memory

Ember Output
Write:
• 3 short observations about interaction patterns
• 1 forward-looking insight about how this dynamic might evolve
Use each person’s first name. Do not use “you” in these sections even if Ember’s personality construct says you should.

Step 6 — Next Scenarios
Determine the next scenario_type based on progression and signal coverage.

Scenario Progression Rules
• The first scenario is always conversation_first  
• Subsequent scenarios should prioritize unexplored interaction types 
• Avoid repeating the same scenario_type unless necessary

Preferred progression:
• conversation_first
• playful or collaborative
• whichever of playful or collaborative has not yet been explored
• mild_tension
If earlier interaction signals show a clear weakness, you may prioritize a scenario_type that reveals that dynamic more clearly.

Generate Scenario Options
• Generate 3 scenario options and an ending_note to explain why this set-up  
• All options must test the same scenario_type 
• Each option should use a different setting or activity (from the approved setting list in Step 1)  
• Each should feel like a natural next step

Voice Rule
Write all scenario descriptions and the ending_note in second person (“you”).
Speak directly to the user.
Avoid:
• “they”
• “the two of you”

Framing Rule
Implicitly explain the purpose of the scenario_type without naming it.

Format
Each option should include:
• the setting name
• one concise line describing what this scenario will reveal


Examples
Ending_note: I want to see how your dynamic holds up when there’s a bit more coordination involved.
Scenarios:
Cooking Class  You’d get a feel for how you divide tasks and adjust when something doesn’t go as planned.
Escape Room  You’d see how you share ideas and respond when there’s a bit of pressure to solve something together.
Pottery Studio  A hands-on setting like this shows how you handle small mistakes together.


Ember Opening Line
Before the Scene Snapshot, include a short line introducing the scenario in past-tense. What you expected to learn from the scenario_type - without mentioning it by name - and location. If the location was provided in the input, you are responding to it. If it was not provided, you are talking about why you chose it.
It should:
• reflect the scenario_type
• sound natural and intentional
• not feel clinical

⭐ TITLE FORMAT
"[2 to 3 evocative elements]"
Use elements that relate to:
• an environmental detail 
• a micro-gesture or mannerism 
• a tension or shared beat 
• a phrase or quote from the date 
• an image or moment that stood out 

Output in JSON format: 
{
  "location": "setting name",
  "title": "title of the date",
  "opening_line": "string, Ember's opening line",
  "summary": "summary, no title",
  "summary_b": "summary from user B's perspective",
  "scene": "string with scene snapshot",
  "items": ["appearance and character strings"],
  "moment": "string, overall interaction 1 line",
  "reflections": ["string"],
  "tone_score": "Y/10",
  "key_moments": ["bullet point 1", "bullet point 2"],
  "chemistry_signals": "One single sentence evidence anchor",
  "chemistry_signals_score": "X/10",
  "chemistry_signals_level": "strong/mixed/strained/not-observed",
  "conversational_balance": "One single sentence evidence anchor",
  "conversational_balance_score": "X/10",
  "conversational_balance_level": "strong/mixed/strained/not-observed",
  "conversation_flow": "One single sentence evidence anchor",
  "conversation_flow_score": "X/10",
  "conversation_flow_level": "strong/mixed/strained/not-observed",
  "curiosity": "One single sentence evidence anchor",
  "curiosity_score": "X/10",
  "curiosity_level": "strong/mixed/strained/not-observed",
  "energy_alignment": "One single sentence evidence anchor",
  "energy_alignment_score": "X/10",
  "energy_alignment_level": "strong/mixed/strained/not-observed",
  "humor_alignment": "One single sentence evidence anchor",
  "humor_alignment_score": "X/10",
  "humor_alignment_level": "strong/mixed/strained/not-observed",
  "listening_responsiveness": "One single sentence evidence anchor",
  "listening_responsiveness_score": "X/10",
  "listening_responsiveness_level": "strong/mixed/strained/not-observed",
  "repair_attempts": "One single sentence evidence anchor",
  "repair_attempts_score": "X/10",
  "repair_attempts_level": "strong/mixed/strained/not-observed",
  "responsiveness": "One single sentence evidence anchor",
  "responsiveness_score": "X/10",
  "responsiveness_level": "strong/mixed/strained/not-observed",
  "shared_moments": "One single sentence evidence anchor",
  "shared_moments_score": "X/10",
  "shared_moments_level": "strong/mixed/strained/not-observed",
  "tension_handling": "One single sentence evidence anchor",
  "tension_handling_score": "X/10",
  "tension_handling_level": "strong/mixed/strained/not-observed",
  "pay_attention_to": "string, one short observation about a dynamic to watch for",
  "match_score": "Z/100, factoring in the signal scores",
  "final_why": {
    "observations": [
      "Ember observation 1",
      "Ember observation 2",
      "Ember observation 3"
    ],
    "insight": "Forward-looking insight"
  },
  "mood": "string",
  "tags": [
    "3 short insights on compatibility in plain text"
  ],
  "flags": {
    "green": [
      "string"
    ],
    "yellow": [
      "string"
    ],
    "red": [
      "string"
    ]
  },
  "ending_note": "string, a closing observation from Ember",
  "next_scenarios": [
    {
      "location": "Setting Name",
      "scenario_type": "conversation_first|playful|collaborative|mild_tension",
      "description": "One concise line describing what this scenario will reveal"
    },
    {
      "location": "Setting Name 2",
      "scenario_type": "conversation_first|playful|collaborative|mild_tension",
      "description": "One concise line describing what this scenario will reveal"
    },
    {
      "location": "Setting Name 3",
      "scenario_type": "conversation_first|playful|collaborative|mild_tension",
      "description": "One concise line describing what this scenario will reveal"
    }
  ],
  "tone_trend": "string",
  "avg_match_score": "number"
}
    `,
		getUsersInformation: async (user1: UserType, user2: UserType) => summaryPrompts.v5.getUsersInformation(user1, user2),
	},
}

export const addAdditionalQAToInput = (input: any, questions: string[], answers: string[] | undefined) => {
	const sanitizedQuestion = (q: string) =>
		q
			.trim()
			.toLocaleLowerCase()
			.replace(/^[^a-z]+|[^\w-]+/g, '')
	// input.questions_for_date might have values already
	// if so, if question is duplicate, update answer, if not, add question and answer
	const inputObj = typeof input === 'string' ? JSON.parse(input.replace(/```json\n/g, '').replace(/\n\`\`\`/g, '')) : input
	const existingQuestions: string[] = inputObj?.questions_for_date || []
	const existingAnswers: string[] = inputObj?.my_answers_for_date || []
	questions.forEach((question, index) => {
		const answer = answers ? answers[index] || 'N/A' : 'N/A'
		const existingIndex = existingQuestions.findIndex(q => sanitizedQuestion(q) === sanitizedQuestion(question))
		if (existingIndex !== -1) {
			// update answer
			existingAnswers[existingIndex] = answer
		} else {
			// add question and answer
			existingQuestions.push(question)
			existingAnswers.push(answer)
		}
	})
	return {
		...inputObj,
		questions_for_date: existingQuestions,
		my_answers_for_date: existingAnswers,
	}
}

export const getUserPriorDates = (userA: UserType, userB: UserType) => {
	return Moment.find({
		$or: [
			{
				user_a: userA._id,
				user_b: userB._id,
			},
			{
				user_a: userB._id,
				user_b: userA._id,
				private_to_a: false,
			},
		],
	})
		.sort({ createdAt: -1 })
		.limit(10)
		.lean()
		.exec()
}

export const getUserDatesCount = (userAId: string, userBId: string) => {
	return Moment.countDocuments({
		$or: [
			{
				user_a: userAId,
				user_b: userBId,
			},
			{
				user_a: userBId,
				user_b: userAId,
				private_to_a: false,
			},
		],
	}).exec()
}
