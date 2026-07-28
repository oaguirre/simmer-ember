import { type UserType } from '../../resources/user/model'

const pick = (source: Record<string, any>, keys: string[]) => {
	return keys.reduce<Record<string, any>>((acc, key) => {
		if (source[key] !== undefined) acc[key] = source[key]
		return acc
	}, {})
}

const SELF_FIELDS = [
	'_id',
	'first_name',
	'last_name',
	'username',
	'gender',
	'genders_to_date',
	'height',
	'weight_lbs',
	'email',
	'phone',
	'is_phone_verified',
	'is_email_verified',
	'is_test_user',
	'is_banned',
	'have_kids',
	'want_kids',
	'smoking',
	'cannabis',
	'relationship_structure',
	'pets',
	'have_pets',
	'faith_importance',
	'location_radius',
	'vaccination_stance',
	'deal_break_lightning',
	'loc_latitude',
	'loc_longitude',
	'loc_address',
	'loc_city',
	'loc_state',
	'loc_country',
	'loc_postal_code',
	'drinking',
	'political_view',
	'about',
	'languages',
	'date_of_birth',
	'exercise',
	'culture',
	'education',
	'education_school',
	'job',
	'religion',
	'activities',
	'core_questions',
	'core_answers',
	'avatar_generated_at',
	'born_location',
	'high_priority_values',
	'in_relationship_with',
	'preferences',
	'media',
	'profile_image_media_id',
	'createdAt',
	'updatedAt',
]

const PUBLIC_FIELDS = [
	'_id',
	'first_name',
	'gender',
	'genders_to_date',
	'height',
	'weight_lbs',
	'is_test_user',
	'have_kids',
	'want_kids',
	'smoking',
	'cannabis',
	'relationship_structure',
	'pets',
	'have_pets',
	'faith_importance',
	'location_radius',
	'vaccination_stance',
	'deal_break_lightning',
	'loc_city',
	'loc_state',
	'loc_country',
	'drinking',
	'political_view',
	'about',
	'languages',
	'exercise',
	'culture',
	'education',
	'religion',
	'activities',
	'core_questions',
	'core_answers',
	'avatar_generated_at',
	'high_priority_values',
	'in_relationship_with',
	'media',
	'profile_image_media_id',
	'preferences',
	'createdAt',
	'updatedAt',
]

export const toSelfUser = (user: UserType | Record<string, any> | null | undefined): Record<string, any> | null => {
	if (!user) return null
	return pick(user as Record<string, any>, SELF_FIELDS)
}

export const toPublicUser = (user: UserType | Record<string, any> | null | undefined): Record<string, any> | null => {
	if (!user) return null
	return pick(user as Record<string, any>, PUBLIC_FIELDS)
}
