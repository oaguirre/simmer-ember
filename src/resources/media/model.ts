import mongoose from 'mongoose'

export interface MediaType extends mongoose.Document {
	_id?: mongoose.Types.ObjectId | string
	digest_id?: string
	user_id?: mongoose.Types.ObjectId | string
	reference_user_ids?: mongoose.Types.ObjectId[] | string[]
	moment_id?: mongoose.Types.ObjectId | string
	title?: string
	description?: string
	filename?: string
	path?: string
	alias?: string
	url?: string
	type?: 'image' | 'video' | 'audio' | 'other'
	train_avatar?: boolean
	createdAt?: Date
	updatedAt?: Date
}

const mediaSchema: mongoose.Schema<MediaType> = new mongoose.Schema<MediaType>(
	{
		digest_id: {
			type: String,
			required: false,
			index: true,
		},
		user_id: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		reference_user_ids: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: 'User',
				required: false,
			},
		],
		moment_id: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Moment',
		},
		title: {
			type: String,
			required: false,
			trim: true,
			maxlength: 200,
		},
		description: {
			type: String,
			required: false,
			trim: true,
			maxlength: 1024,
		},
		filename: {
			type: String,
			required: true,
		},
		path: {
			type: String,
			required: true,
		},
		alias: {
			type: String,
			required: false,
		},
		url: {
			type: String,
			required: false,
		},
		type: {
			type: String,
			enum: ['image', 'video', 'audio', 'other'],
			default: 'image',
			required: true,
		},
		train_avatar: {
			type: Boolean,
			default: false,
		},
	},
	{ timestamps: true },
)

export const Media = mongoose.model<MediaType>('Media', mediaSchema)
export default Media
