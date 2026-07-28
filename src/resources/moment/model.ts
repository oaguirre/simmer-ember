import mongoose from 'mongoose'
import { UserType } from '../user/model'
import { validateAndFormatFeedback } from '../../utils/user/moment'
import { summarizeCoachMomentPrompts } from '../matches/summarizePrompts'

const Schema = mongoose.Schema

export type MomentTypeEnum = 'date' | 'text' | 'chat' | 'call' | 'gathering' | 'coaching'

export type FeedbackType = {
	_id?: mongoose.Types.ObjectId | string
	source?: 'user_a' | 'user_b' | 'ai' | 'manager' | 'external'
	target?: 'ember' | 'simmie' | 'relationship' | 'personal'
	validation_score?: number
	question?: string
	answer?: string
	comment?: string
	title?: string
	summary?: string
	when: Date
}

export interface MomentType extends mongoose.Document {
	_id?: mongoose.Types.ObjectId
	type: MomentTypeEnum
	user_a: mongoose.Types.ObjectId | UserType
	user_b?: mongoose.Types.ObjectId | UserType
	universe?: 'simmer-world' | 'reality'
	source?: 'user' | 'ai' | 'external'
	private_to_a?: boolean
	version?: string
	model?: string
	provider?: string
	match_score?: string
	tone_score?: string
	key_moments?: string[]
	summary_a?: string
	summary_b?: string
	tags?: string[]
	journal_a?: string[]
	journal_b?: string[]
	conversation?: string
	when: Date
	image_urls?: string[]
	image_input_tokens?: number
	image_output_tokens?: number
	input_tokens?: number
	output_tokens?: number
	location?: string
	items?: string[]
	mood?: string
	title?: string
	scene?: string
	moment?: string
	reflections?: string[]

	conversational_balance?: string
	conversational_balance_level?: string
	conversational_balance_score?: number
	curiosity?: string
	curiosity_level?: string
	curiosity_score?: number
	chemistry_signals?: string
	chemistry_signals_level?: string
	chemistry_signals_score?: number
	humor_alignment?: string
	humor_alignment_level?: string
	humor_alignment_score?: number
	listening_responsiveness?: string
	listening_responsiveness_level?: string
	listening_responsiveness_score?: number
	repair_attempts?: string
	repair_attempts_level?: string
	repair_attempts_score?: number
	responsiveness?: string
	responsiveness_level?: string
	responsiveness_score?: number
	shared_moments?: string
	shared_moments_level?: string
	shared_moments_score?: number
	tension_handling?: string
	tension_handling_level?: string
	tension_handling_score?: number
	energy_alignment?: string
	energy_alignment_level?: string
	energy_alignment_score?: number

	pay_attention_to?: string[]

	// Legacy aliases kept for backward compatibility.
	conversation_flow?: string
	conversation_flow_score?: number
	conversation_flow_level?: string

	compatibility_penalty?: string
	compatibility_penalty_points?: number
	flags?: {
		green: string[]
		yellow: string[]
		red: string[]
	}
	opening_line?: string
	ending_note?: string
	next_scenarios?: {
		location: string
		scenario_type: string
		description: string
	}[]
	tone_trend?: string
	avg_match_score?: number
	soft_delete_user_a?: Date
	soft_delete_user_b?: Date
	final_why?: {
		observations: string[]
		insight: string
	}
	feedback?: FeedbackType[]
	createdAt?: Date
	updatedAt?: Date
}

const momentSchema = new Schema<MomentType>(
	{
		user_a: {
			type: Schema.Types.ObjectId as any,
			ref: 'User',
			required: true,
			select: true,
		},
		user_b: {
			type: Schema.Types.ObjectId as any,
			required: false,
			ref: 'User',
			select: true,
		},
		type: {
			type: String,
			required: false,
			enum: ['date', 'text', 'chat', 'call', 'gathering', 'coaching'] as MomentTypeEnum[],
			default: 'date',
			select: true,
		},
		universe: {
			type: String,
			required: false,
			enum: ['simmer-world', 'reality'],
			default: 'simmer-world',
			select: true,
		},
		source: {
			type: String,
			required: false,
			enum: ['user', 'ai', 'external'],
			default: 'ai',
			select: true,
		},
		private_to_a: {
			type: Boolean,
			required: false,
			default: false,
		},
		version: {
			type: String,
			required: false,
			select: true,
		},
		model: {
			type: String,
			required: false,
			select: true,
		},
		provider: {
			type: String,
			required: false,
			enum: ['openai', 'claude', 'gemini', 'custom'],
			select: true,
		},
		match_score: {
			type: String,
			required: false,
			select: true,
		},
		tone_score: {
			type: String,
			required: false,
			select: true,
		},
		summary_a: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 10240,
			select: true,
		},
		summary_b: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 10240,
			select: true,
		},
		tags: {
			type: [String],
			required: false,
			default: [],
			select: true,
		},
		journal_a: {
			type: [String],
			required: false,
			select: true,
		},
		journal_b: {
			type: [String],
			required: false,
			select: true,
		},
		conversation: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 102400,
			select: true,
		},
		when: {
			type: Date,
			required: true,
			default: Date.now,
			select: true,
		},
		image_urls: {
			type: [String],
			required: false,
			default: [],
			select: true,
		},
		location: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 256,
			select: true,
		},
		items: {
			type: [String],
			required: false,
			default: [],
			select: true,
		},
		mood: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 256,
			select: true,
		},
		title: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 256,
			select: true,
		},
		image_input_tokens: {
			type: Number,
			required: false,
			select: true,
		},
		image_output_tokens: {
			type: Number,
			required: false,
			select: true,
		},
		input_tokens: {
			type: Number,
			required: false,
			select: true,
		},
		output_tokens: {
			type: Number,
			required: false,
			select: true,
		},
		scene: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 5120,
			select: true,
		},
		moment: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 5120,
			select: true,
		},
		reflections: {
			type: [String],
			required: false,
			default: [],
			select: true,
		},

		conversational_balance: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		conversational_balance_level: {
			type: String,
			required: false,
			enum: ['strong', 'mixed', 'strained'],
			select: true,
		},
		conversational_balance_score: {
			type: Number,
			required: false,
		},
		curiosity: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		curiosity_level: {
			type: String,
			required: false,
			enum: ['strong', 'mixed', 'strained'],
			select: true,
		},
		curiosity_score: {
			type: Number,
			required: false,
		},
		chemistry_signals: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 2048,
			select: true,
		},
		chemistry_signals_level: {
			type: String,
			required: false,
			enum: ['strong', 'mixed', 'strained'],
			select: true,
		},
		chemistry_signals_score: {
			type: Number,
			required: false,
		},
		humor_alignment: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		humor_alignment_level: {
			type: String,
			required: false,
			enum: ['strong', 'mixed', 'strained'],
			select: true,
		},
		humor_alignment_score: {
			type: Number,
			required: false,
		},
		listening_responsiveness: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		listening_responsiveness_level: {
			type: String,
			required: false,
			enum: ['strong', 'mixed', 'strained'],
			select: true,
		},
		listening_responsiveness_score: {
			type: Number,
			required: false,
		},
		repair_attempts: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		repair_attempts_level: {
			type: String,
			required: false,
			enum: ['strong', 'mixed', 'strained'],
			select: true,
		},
		repair_attempts_score: {
			type: Number,
			required: false,
		},
		responsiveness: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		responsiveness_level: {
			type: String,
			required: false,
			enum: ['strong', 'mixed', 'strained'],
			select: true,
		},
		responsiveness_score: {
			type: Number,
			required: false,
		},
		shared_moments: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 2048,
			select: true,
		},
		shared_moments_level: {
			type: String,
			required: false,
			enum: ['strong', 'mixed', 'strained'],
			select: true,
		},
		shared_moments_score: {
			type: Number,
			required: false,
		},
		tension_handling: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		tension_handling_level: {
			type: String,
			required: false,
			enum: ['strong', 'mixed', 'strained'],
			select: true,
		},
		tension_handling_score: {
			type: Number,
			required: false,
		},
		energy_alignment: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		energy_alignment_level: {
			type: String,
			required: false,
			enum: ['strong', 'mixed', 'strained'],
			select: true,
		},
		energy_alignment_score: {
			type: Number,
			required: false,
		},
		pay_attention_to: {
			type: [String],
			required: false,
			default: [],
			select: true,
		},

		conversation_flow: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		conversation_flow_level: {
			type: String,
			required: false,
			enum: ['strong', 'mixed', 'strained'],
			select: true,
		},
		conversation_flow_score: {
			type: Number,
			required: false,
		},
		compatibility_penalty_points: {
			type: Number,
			required: false,
		},
		compatibility_penalty: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 2048,
			select: true,
		},
		flags: {
			type: [
				{
					green: [String],
					yellow: [String],
					red: [String],
				},
			],
			required: false,
			default: [],
			select: true,
		},
		tone_trend: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		opening_line: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		ending_note: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 1024,
			select: true,
		},
		next_scenarios: {
			type: [
				{
					location: { type: String, required: true },
					scenario_type: { type: String, required: true },
					description: { type: String, required: true },
				},
			],
			required: false,
			default: undefined,
			select: true,
		},
		avg_match_score: {
			type: Number,
			required: false,
			select: true,
		},
		key_moments: {
			type: [String],
			required: false,
			default: [],
			select: true,
		},
		soft_delete_user_a: {
			type: Date,
			required: false,
			select: true,
		},
		soft_delete_user_b: {
			type: Date,
			required: false,
			select: true,
		},
		final_why: {
			type: {
				observations: { type: [String] },
				insight: { type: String },
			},
			required: false,
			select: true,
		},

		feedback: {
			type: [
				{
					source: {
						type: String,
						enum: ['user_a', 'user_b', 'ai', 'manager', 'external'],
						default: 'user_a',
						required: false,
					},
					target: {
						type: String,
						enum: ['ember', 'simmie', 'relationship', 'personal'],
						default: 'personal',
						required: false,
					},
					validation_score: {
						type: Number,
						required: false,
					},
					question: { type: String },
					answer: { type: String },
					comment: { type: String },
					summary: { type: String },
					title: { type: String },
					when: { type: Date },
				},
			],
			required: false,
			default: [],
			select: true,
		},
		createdAt: {
			type: Date,
			default: Date.now,
			select: true,
		},
		updatedAt: {
			type: Date,
			default: Date.now,
			select: true,
		},
	},
	{
		timestamps: true,
		collection: 'moments',
	},
)

export const Moment = mongoose.model<MomentType>('Moment', momentSchema, 'moments')
