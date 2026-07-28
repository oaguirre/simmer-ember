import mongoose from 'mongoose'
import { UserType } from '../user/model'

const Schema = mongoose.Schema

export type RelationshipTypeEnum = 'potential' | 'friend' | 'dating' | 'blocked' | 'archived'
export type RelationshipStatusType = 'initial' | 'ongoing' | 'not_interested' | 'blocked' | 'removed_by_a' | 'removed_by_b' | 'suspended'
export type RelationshipStageType =
	| 'initial'
	| 'presented'
	| 'matched'
	| 'talking'
	| 'friends'
	| 'dating'
	| 'exclusive'
	| 'serious_relationship'
	| 'engaged'
	| 'married'
	| 'separated'
	| 'ended'

export interface RelationshipType extends mongoose.Document {
	_id?: mongoose.Types.ObjectId
	user_a: mongoose.Types.ObjectId | UserType
	user_b: mongoose.Types.ObjectId | UserType
	type: 'potential' | 'friend' | 'dating' | 'blocked' | 'archived'
	last_interaction?: Date
	anniversary_date?: Date
	status?: RelationshipStatusType
	stage?: RelationshipStageType
	tags?: string[]
	horoscope_compatibility?: string
	shared_interests?: string[]
	next_action?: string
	next_steps?: string
	notes?: string
	avg_match_score: number
	tone_trend: string
	short_term_memory: {
		moment_id?: mongoose.Types.ObjectId
		when: Date
		title: string
		summary_a: string
		summary_b?: string
		flags?: {
			green: string[]
			yellow: string[]
			red: string[]
		}
		tone_score?: string
		match_score?: string
		key_moments?: string[]
		opening_line?: string
		ending_note?: string
		final_why?: {
			observations: string[]
			insight: string
		}
	}[]
	long_term_memory?: {
		year: number
		relevant_dates?: Date[]
		summary?: string
		tone_score?: string
		avg_match_score?: string
		key_moments?: string[]
		final_why?: { observations: string[]; insights: string[] }
		start_status?: RelationshipStatusType
		final_status?: RelationshipStatusType
		start_stage?: RelationshipStageType
		final_stage?: RelationshipStageType
	}[]
	digest?: {
		history_level: 'none' | 'thin' | 'moderate' | 'established'
		temperature: 'warming' | 'steady_warm' | 'mixed' | 'cooling' | 'cautious' | 'unclear'
		core_dynamic: 'one sentence describing the central relationship pattern'
		strengths: string[]
		limitations: string[]
		callbacks_allowed: string[]
		behavioral_continuity: string[]
		next_scene_should_test: 'one sentence describing what the next simulation should reveal'
		next_scene_should_avoid: 'one sentence describing what the next simulation should not over-assume or flatten'
	}
	deletedAt?: Date
	createdAt?: Date
	updatedAt?: Date
}

const relationshipSchema = new Schema<RelationshipType>(
	{
		user_a: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			select: true,
		},
		user_b: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'User',
			select: true,
		},
		type: {
			type: String,
			required: true,
			enum: ['potential', 'friend', 'dating', 'blocked', 'archived'],
			default: 'potential',
			select: true,
		},
		anniversary_date: {
			type: Date,
			required: false,
			select: true,
		},
		status: {
			type: String,
			required: false,
			enum: ['initial', 'ongoing', 'not_interested', 'blocked', 'removed_by_a', 'removed_by_b', 'suspended'],
			default: 'initial',
			select: true,
		},
		stage: {
			type: String,
			required: false,
			enum: ['initial', 'presented', 'matched', 'talking', 'friends', 'dating', 'exclusive', 'serious_relationship', 'engaged', 'married', 'separated', 'ended'],
			default: 'initial',
			select: true,
		},
		tags: {
			type: [String],
			required: false,
			default: [],
			select: true,
		},
		horoscope_compatibility: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 256,
			select: true,
		},
		shared_interests: {
			type: [String],
			required: false,
			default: [],
			select: true,
		},
		next_action: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 256,
			select: true,
		},
		next_steps: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 512,
			select: true,
		},
		notes: {
			type: String,
			required: false,
			trim: true,
			minlength: 0,
			maxlength: 2048,
			select: true,
		},
		avg_match_score: {
			type: Number,
			required: false,
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
		short_term_memory: {
			type: [
				{
					moment_id: {
						type: Schema.Types.ObjectId,
						ref: 'Moment',
						required: false,
					},
					when: { type: Date },
					title: { type: String },
					summary_a: { type: String },
					summary_b: { type: String },
					flags: {
						green: { type: [String] },
						yellow: { type: [String] },
						red: { type: [String] },
					},
					tone_score: { type: String },
					match_score: { type: String },
					key_moments: { type: [String] },
					opening_line: { type: String },
					ending_note: { type: String },
					final_why: { observations: { type: [String] }, insight: { type: String } },
				},
			],
			required: false,
			default: [],
			select: true,
		},
		long_term_memory: {
			type: [
				{
					year: { type: Number },
					relevant_dates: { type: [Date] },
					summary: { type: String },
					tone_score: { type: String },
					avg_match_score: { type: String },
					key_moments: { type: [String] },
					final_why: { observations: { type: [String] }, insights: { type: [String] } },
					start_status: {
						type: String,
						required: false,
						enum: ['initial', 'ongoing', 'not_interested', 'blocked', 'removed_by_a', 'removed_by_b', 'suspended'],
						default: 'initial',
					},
					final_status: {
						type: String,
						required: false,
						enum: ['initial', 'ongoing', 'not_interested', 'blocked', 'removed_by_a', 'removed_by_b', 'suspended'],
					},
					start_stage: {
						type: String,
						required: false,
						enum: ['initial', 'presented', 'matched', 'talking', 'friends', 'dating', 'exclusive', 'serious_relationship', 'engaged', 'married', 'separated', 'ended'],
						default: 'initial',
					},
					final_stage: {
						type: String,
						required: false,
						enum: ['initial', 'presented', 'matched', 'talking', 'friends', 'dating', 'exclusive', 'serious_relationship', 'engaged', 'married', 'separated', 'ended'],
					},
				},
			],
			required: false,
			default: [],
			select: true,
		},
		digest: {
			required: false,
			select: true,
			type: {
				history_level: {
					type: String,
					enum: ['none', 'thin', 'moderate', 'established'],
				},
				temperature: {
					type: String,
					enum: ['warming', 'steady_warm', 'mixed', 'cooling', 'cautious', 'unclear'],
				},
				core_dynamic: { type: String },
				strengths: { type: [String] },
				limitations: { type: [String] },
				callbacks_allowed: { type: [String] },
				behavioral_continuity: { type: [String] },
				next_scene_should_test: { type: String },
				next_scene_should_avoid: { type: String },
			},
		},
		deletedAt: {
			type: Date,
			required: false,
			select: true,
		},
	} as any,
	{ timestamps: true },
)

export const Relationship = mongoose.model<RelationshipType>('Relationship', relationshipSchema)
