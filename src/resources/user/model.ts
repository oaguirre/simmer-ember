import bcrypt from 'bcrypt'
import mongoose from 'mongoose'
import { config } from '../../constants/config'
import { ApiError } from '../../utils'
import { MediaType } from '../media/model'

const Schema = mongoose.Schema

export const defaultQuestions = [
	'Describe your perfect lazy Sunday',
	'How do you tend to handle conflict?',
	"What's something weird or small that brings you joy?",
	'When someone really gets to know you, what might surprise them?',
	'What makes you feel truly seen in a relationship?',
]
export interface UserType extends mongoose.Document {
	_id?: mongoose.Types.ObjectId | string
	first_name?: string
	last_name?: string
	username?: string
	gender?: 'male' | 'female' | 'non-binary' | 'other' | 'prefer_not_to_say'
	genders_to_date?: Array<'male' | 'female' | 'non-binary' | 'other'>
	height?: number
	weight_lbs?: number
	password?: string
	is_test_user?: boolean
	is_admin?: boolean
	is_banned?: boolean
	plan?: 'free' | 'gold'
	plan_expires_at?: Date
	email?: string
	phone?: string
	is_phone_verified?: boolean
	is_email_verified?: boolean
	aesthetics?: number

	have_kids?: 'unanswered' | 'no' | 'yes' | 'prefer_not_to_say'
	want_kids?: 'unanswered' | 'no' | 'yes' | 'maybe' | 'prefer_not_to_say'

	smoking?: 'unanswered' | 'regularly' | 'socially' | 'rarely' | 'never'
	cannabis?: 'unanswered' | 'regularly' | 'socially' | 'rarely' | 'never' | 'sober'
	relationship_structure?: 'unanswered' | 'long_term_relationship' | 'short_term_relationship' | 'casual_dating' | 'new_friends' | 'prefer_not_to_say'
	pets?: 'unanswered' | 'love' | 'like' | 'prefer_no' | 'allergic'
	have_pets?: 'unanswered' | 'dog' | 'cat' | 'other' | 'none'
	faith_importance?: 'unanswered' | 'not_important' | 'somewhat_important' | 'very_important' | 'extremely_important'
	location_radius?: number
	vaccination_stance?: 'unanswered' | 'pro_vaccination' | 'anti_vaccination' | 'some' | 'prefer_not_to_say'
	deal_break_lightning?: string[]

	loc_latitude?: number
	loc_longitude?: number
	loc_address?: string
	loc_city?: string
	loc_state?: string
	loc_country?: string
	loc_postal_code?: string

	drinking?: 'unanswered' | 'regularly' | 'socially' | 'rarely' | 'never' | 'sober'
	political_view?: 'unanswered' | 'liberal' | 'conservative' | 'moderate' | 'libertarian' | 'apolitical'
	about?: string
	languages?: string[]
	date_of_birth?: Date
	exercise?: 'unanswered' | 'daily' | 'few_times_per_week' | 'once_per_week' | 'occasionally' | 'rarely' | 'never'
	culture?: string[]
	education?: 'unanswered' | 'high_school' | 'some_college' | 'associate_degree' | 'bachelors_degree' | 'masters_degree' | 'doctorate' | 'trade_school'
	education_school?: string
	job?: string
	religion?: 'unanswered' | 'christian' | 'jewish' | 'muslim' | 'hindu' | 'buddhist' | 'spiritual' | 'agnostic' | 'athiest' | 'other'
	activities?: string[]
	core_questions?: string[]
	core_answers?: string[]
	avatar_generated_at?: Date
	born_location?: string
	high_priority_values?: string[]
	in_relationship_with?: mongoose.Types.ObjectId | string
	profile_image_media_id?: mongoose.Types.ObjectId | string | MediaType

	preferences?: {
		age_min?: number
		age_max?: number
		distance_max?: number
		height_min?: number
		height_max?: number
		exercise?: Array<'unanswered' | 'daily' | 'few_times_per_week' | 'once_per_week' | 'occasionally' | 'rarely' | 'never'>
		have_kids?: Array<'unanswered' | 'no' | 'yes' | 'prefer_not_to_say'>
		smoking?: Array<'unanswered' | 'regularly' | 'socially' | 'rarely' | 'never'>
		cannabis?: Array<'unanswered' | 'regularly' | 'socially' | 'rarely' | 'never' | 'sober'>
		relationship_structure?: Array<'unanswered' | 'long_term_relationship' | 'short_term_relationship' | 'casual_dating' | 'new_friends' | 'prefer_not_to_say'>
		drinking?: Array<'unanswered' | 'regularly' | 'socially' | 'rarely' | 'never' | 'sober'>
		political_view?: Array<'unanswered' | 'liberal' | 'conservative' | 'moderate' | 'libertarian' | 'apolitical'>
		pets?: Array<'unanswered' | 'dog' | 'cat' | 'other' | 'none'>
	}

	checkPassword: (password: string) => Promise<boolean>
	getUpdate: () => any
	createdAt?: Date
	updatedAt?: Date

	media?: MediaType[]
}

const userSchema: mongoose.Schema<UserType> = new Schema<UserType>(
	{
		first_name: {
			type: String,
			required: false,
			trim: true,
			minlength: 1,
			maxlength: 50,
		},
		last_name: {
			type: String,
			required: false,
			trim: true,
			minlength: 2,
			maxlength: 50,
		},
		gender: {
			type: String,
			enum: ['male', 'female', 'non-binary', 'other', 'prefer_not_to_say'],
			default: 'prefer_not_to_say',
		}, // Array of
		genders_to_date: {
			type: [String],
			enum: ['male', 'female', 'non-binary', 'other'],
			default: [],
		}, // Array
		username: {
			type: String,
			trim: true,
		},
		password: {
			type: String,
			required: true,
			select: false,
		},
		is_admin: {
			type: Boolean,
			default: false,
		},
		is_test_user: {
			type: Boolean,
			default: false, // Whether the user is a test user
		},
		is_banned: {
			type: Boolean,
			default: false,
		},
		plan: {
			type: String,
			enum: ['free', 'pro'],
			default: 'free',
		},
		plan_expires_at: {
			type: Date,
			default: Date.now,
		},
		height: {
			type: Number,
			required: false,
		},
		weight_lbs: {
			type: Number,
			required: false,
		},
		email: {
			type: String,
			required: false, // Email of the user
			select: false,
			// unique: true,
			trim: true,
			lowercase: true,
			match: [/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/, 'Please fill a valid email address'],
		},
		phone: {
			type: String,
			required: false, // Phone number of the user
			select: false,
			// unique: true,
			trim: true,
			match: [/^\+?[1-9]\d{1,14}$/, 'Please fill a valid phone number'], // E.164 format
		},
		is_phone_verified: {
			type: Boolean,
			default: false, // Whether the phone number is verified
		},
		is_email_verified: {
			type: Boolean,
			default: false,
		},
		aesthetics: {
			type: Number,
			select: false,
			min: 0,
			max: 100,
			default: 50, // Aesthetics score of the user
		},
		exercise: {
			type: String,
			required: false,
			enum: ['unanswered', 'daily', 'few_times_per_week', 'once_per_week', 'occasionally', 'rarely', 'never'],
			default: 'unanswered',
		},
		have_kids: {
			type: String,
			enum: ['unanswered', 'no', 'yes', 'prefer_not_to_say'],
			default: 'unanswered',
		},
		want_kids: {
			type: String,
			enum: ['unanswered', 'no', 'yes', 'maybe', 'prefer_not_to_say'],
			default: 'unanswered',
		},
		smoking: {
			type: String,
			enum: ['unanswered', 'regularly', 'socially', 'rarely', 'never'],
			default: 'unanswered',
		},
		cannabis: {
			type: String,
			enum: ['unanswered', 'regularly', 'socially', 'rarely', 'never', 'sober'],
			default: 'unanswered',
		},
		relationship_structure: {
			type: String,
			enum: ['unanswered', 'long_term_relationship', 'short_term_relationship', 'casual_dating', 'new_friends', 'prefer_not_to_say'],
			default: 'unanswered',
		},
		pets: {
			type: String,
			enum: ['unanswered', 'love', 'like', 'prefer_no', 'allergic'],
			default: 'unanswered',
		},
		have_pets: {
			type: String,
			enum: ['unanswered', 'dog', 'cat', 'other', 'none'],
			default: 'unanswered',
		},
		education: {
			type: String,
			enum: ['unanswered', 'high_school', 'some_college', 'associate_degree', 'bachelors_degree', 'masters_degree', 'doctorate', 'trade_school'],
			default: 'unanswered',
		},
		education_school: {
			type: String,
			required: false,
			trim: true,
			maxlength: 100,
		},
		job: {
			type: String,
			required: false,
			trim: true,
			maxlength: 100, // Job title of the user
		},
		religion: {
			type: String,
			enum: ['unanswered', 'christian', 'jewish', 'muslim', 'hindu', 'buddhist', 'spiritual', 'agnostic', 'athiest', 'other'],
			default: 'unanswered',
		},
		activities: {
			type: [String],
			default: [],
			required: false,
		},
		culture: {
			type: [String],
			default: [],
			required: false,
		},
		faith_importance: {
			type: String,
			enum: ['unanswered', 'not_important', 'somewhat_important', 'very_important', 'extremely_important'],
			default: 'unanswered',
		},
		location_radius: {
			type: Number,
			default: 50, // in miles
		},
		vaccination_stance: {
			type: String,
			enum: ['unanswered', 'pro_vaccination', 'anti_vaccination', 'some', 'prefer_not_to_say'],
			default: 'unanswered',
		},
		deal_break_lightning: {
			type: [String],
			default: [],
		},
		loc_latitude: {
			type: Number, // Latitude for location
			required: false,
			select: false,
		},
		loc_longitude: {
			type: Number, // Longitude for location
			required: false,
			select: false,
		},
		loc_address: {
			type: String, // Full address of the user
			required: false,
			select: false,
		},
		loc_city: {
			type: String, // City of the user
			required: false,
		},
		loc_state: {
			type: String, // State of the user
			required: false,
		},
		loc_country: {
			type: String, // Country of the user
			required: false,
			default: 'US', // Default country set to United States
		},
		loc_postal_code: {
			type: String, // Postal code of the user
			required: false,
			select: false,
		},

		drinking: {
			type: String,
			enum: ['unanswered', 'regularly', 'socially', 'rarely', 'never', 'sober'],
			default: 'unanswered', // Whether the user drinks alcohol or not
		},
		political_view: {
			type: String,
			enum: ['unanswered', 'liberal', 'conservative', 'moderate', 'libertarian', 'apolitical'],
			default: 'unanswered', // Political view of the user
		},
		about: {
			type: String,
			required: false,
			trim: true,
			maxlength: 500, // Short bio or description about the user
		},
		languages: {
			type: [String],
			default: ['english'], // Languages spoken by the user
		},
		date_of_birth: {
			type: Date,
			required: false, // Date of birth of the user
			select: false,
		},
		core_questions: {
			type: [String],
			default: [],
		},
		core_answers: {
			type: [String],
			default: [],
		},
		profile_image_media_id: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Media',
			required: false,
		},
		avatar_generated_at: {
			type: Date,
			required: false,
		},
		born_location: {
			type: String,
			required: false,
			trim: true,
			maxlength: 100,
		},
		high_priority_values: {
			type: [String],
			default: [],
		},
		in_relationship_with: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: false,
		},

		preferences: {
			age_min: {
				type: Number,
				required: false,
			},
			age_max: {
				type: Number,
				required: false,
			},
			distance_max: {
				type: Number,
				required: false,
			},
			height_min: {
				type: Number,
				required: false,
			},
			height_max: {
				type: Number,
				required: false,
			},
			exercise: {
				type: [String],
				required: false,
				enum: ['unanswered', 'daily', 'few_times_per_week', 'once_per_week', 'occasionally', 'rarely', 'never'],
				default: [],
			},
			have_kids: {
				type: [String],
				enum: ['unanswered', 'no', 'yes', 'prefer_not_to_say'],
				default: [],
			},
			smoking: {
				type: [String],
				enum: ['unanswered', 'regularly', 'socially', 'rarely', 'never'],
				default: [],
			},
			cannabis: {
				type: [String],
				enum: ['unanswered', 'regularly', 'socially', 'rarely', 'never', 'sober'],
				default: [],
			},
			relationship_structure: {
				type: [String],
				enum: ['unanswered', 'long_term_relationship', 'short_term_relationship', 'casual_dating', 'new_friends', 'prefer_not_to_say'],
				default: [],
			},
			drinking: {
				type: [String],
				enum: ['unanswered', 'regularly', 'socially', 'rarely', 'never', 'sober'],
				default: [],
			},
			political_view: {
				type: [String],
				enum: ['unanswered', 'liberal', 'conservative', 'moderate', 'libertarian', 'apolitical'],
				default: [],
			},
			pets: {
				type: [String],
				enum: ['unanswered', 'dog', 'cat', 'other', 'none'],
				default: [],
			},
		},
	},
	{ timestamps: true },
)

userSchema.virtual('media', {
	ref: 'Media', // The model to use
	localField: '_id', // Find books where 'authorId' matches this '_id'
	foreignField: 'user_id',
})

userSchema.pre<UserType>('save', async function () {
	try {
		if (!this.isModified('password') || !this.password) return
		const salt = await bcrypt.genSalt(config.saltWorkFactor)
		this.password = await bcrypt.hash(this.password, salt)
	} catch (error: any) {
		throw ApiError.internal(String(error), 'pre save hook')
	}
})

userSchema.pre<UserType>('findOneAndUpdate', async function () {
	try {
		if (!this.getUpdate().password) return
		const salt = await bcrypt.genSalt(config.saltWorkFactor)
		this.getUpdate().password = await bcrypt.hash(this.getUpdate().password, salt)
	} catch (error: any) {
		throw ApiError.internal(String(error), 'pre findOneAndUpdate hook')
	}
})

userSchema.methods.checkPassword = async function (password: string): Promise<boolean> {
	try {
		const same = await bcrypt.compare(password, this.password)
		return same
	} catch (error: any) {
		throw ApiError.internal(String(error), 'checkPassword')
	}
}
export const User = mongoose.model<UserType>('User', userSchema)
