import mongoose from 'mongoose'

export interface LearningType extends mongoose.Document {
	_id?: mongoose.Types.ObjectId | string
	user_id?: mongoose.Types.ObjectId | string
	private_to_user?: boolean
	reference_user_ids?: mongoose.Types.ObjectId[] | string[]
	moment_ids?: (mongoose.Types.ObjectId | string)[]
	summary?: string
	facts?: string[]
	preferences?: string[]
	avoidances?: string[]
	insights?: string[]
	hypotheses?: string[]
	createdAt?: Date
	updatedAt?: Date
}

const learningSchema: mongoose.Schema<LearningType> = new mongoose.Schema<LearningType>(
	{
		user_id: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			select: true,
		},
		private_to_user: {
			type: Boolean,
			required: false,
			default: false,
		},
		reference_user_ids: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: 'User',
				required: false,
			},
		],
		moment_ids: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: 'Moment',
				select: true,
				required: false,
			},
		],
		summary: {
			type: String,
			required: false,
			select: true,
		},
		facts: {
			type: [String],
			required: false,
			select: true,
		},
		preferences: {
			type: [String],
			required: false,
			select: true,
		},
		avoidances: {
			type: [String],
			required: false,
			select: true,
		},
		insights: {
			type: [String],
			required: false,
			select: true,
		},
		hypotheses: {
			type: [String],
			required: false,
			select: true,
		},
	},
	{
		timestamps: true,
	},
)

const Learning = mongoose.model<LearningType>('Learning', learningSchema)

export default Learning
