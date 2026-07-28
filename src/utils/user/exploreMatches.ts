import mongoose from 'mongoose'
import { type PipelineStage, type LeanDocument } from 'mongoose'
import { type UserType } from '../../resources/user/model'
import { logger } from '../logger'

import cityStateDataByCityState from '../../../data/cityStateData.json'

export interface BuildAffinityOptions {
	/**
	 * If true, require reciprocal interest:
	 * candidate.gender is in source.genders_to_date AND
	 * source.gender is in candidate.genders_to_date
	 */
	requireReciprocal?: boolean

	/** Hard distance filter in miles (in addition to scoring). If null, derive from source.location_radius; if neither present, skip. */
	hardDistanceMiles?: number | null

	/** Exclude candidates whose deal breakers intersect with source's (default true). */
	excludeDealBreakerIntersect?: boolean

	/** include is_test_user (default false). */
	includeTestUsers?: boolean

	/** Include only is_test_user = true (default false) */
	includeOnlyTestUsers?: boolean

	/**
	 * If true, apply `source.preferences` as soft scoring instead of hard
	 * matching, so candidates can still be returned even when they do not fully
	 * satisfy all preference fields.
	 */
	usePreferenceScoring?: boolean

	/** Explicit weights override */
	weights?: Partial<ReturnType<typeof defaultWeights>>
}

const defaultWeights = () => ({
	genderMatch: 20, // passes gender preference filter
	reciprocalGenderBonus: 10,
	kidsExact: 8,
	smokingExact: 6,
	cannabisExact: 6,
	drinkingExact: 6,
	exerciseExact: 6,
	relationshipExact: 8,
	petsExact: 5,
	vaccinationExact: 6,
	politicalExact: 4,
	nonTestUserBonus: 5, // small bonus to non-test users when includeTestUsers is true
	aestheticsBoost: 10, // max boost for aesthetics=100 within first 2 weeks
	minimumAestheticsBoost: 3, // floor weight after decay fully applies

	languagesOverlapEach: 2, // per shared language (capped below)
	languagesMax: 10,

	ageProximity: 8, // max when |Δage| <= 2 years, fades to 0 by 12 years
	faithProximity: 6, // close ordinal match

	distanceProximity: 12, // max when within 5 miles, fades to 0 by ~source radius (or 50)
	highPriorityValuesOverlapEach: 6, // per shared high priority value

	preferenceAgeRange: 10,
	preferenceDistance: 12,
	preferenceHeightRange: 6,
	preferenceExact: 6,
})

const FAITH_ORDER: Record<NonNullable<UserType['faith_importance']>, number> = {
	unanswered: 0,
	not_important: 1,
	somewhat_important: 2,
	very_important: 3,
	extremely_important: 4,
}

/**
 * Builds a MongoDB aggregation pipeline to score candidates by affinity vs. a source user.
 */
export function buildAffinityPipeline(
	source: UserType | LeanDocument<UserType>,
	avoidDuplicateIds = new Set<mongoose.Types.ObjectId | string>(),
	opts: BuildAffinityOptions = {},
): PipelineStage[] {
	const W = { ...defaultWeights(), ...(opts.weights || {}) }
	const preferences = source.preferences || {}
	const usePreferenceScoring = opts.usePreferenceScoring !== false

	const has = (v: any) => v !== undefined && v !== null
	const nonUnanswered = (v?: string | null) => has(v) && v !== 'unanswered'
	const normalizedPreferenceValues = (value: unknown): string[] => {
		const values = Array.isArray(value) ? value : value !== undefined && value !== null ? [value] : []
		return values.filter((v): v is string => typeof v === 'string' && v !== 'unanswered')
	}
	const toFiniteNumber = (v: unknown): number | null => {
		if (typeof v === 'number' && Number.isFinite(v)) return v
		if (typeof v === 'string') {
			const n = Number(v)
			return Number.isFinite(n) ? n : null
		}
		return null
	}

	const initialMatch: Record<string, any> = {
		is_banned: { $ne: true },
		is_admin: { $ne: true },
		avatar_generated_at: { $exists: true }, // must have avatar
		in_relationship_with: null,
	}
	if (opts.includeTestUsers === false && !opts.includeOnlyTestUsers) {
		initialMatch.is_test_user = { $ne: true }
	}
	if (opts.includeOnlyTestUsers === true) {
		initialMatch.is_test_user = true
	}
	if (avoidDuplicateIds.size > 0) {
		initialMatch._id = { $nin: Array.from(avoidDuplicateIds).map(id => new mongoose.Types.ObjectId(id)) }
	}
	// Optional gender preference hard filter
	const genderFilters: any[] = []
	if (Array.isArray(source.genders_to_date) && source.genders_to_date.length > 0) {
		if (!source.genders_to_date.includes('other')) {
			genderFilters.push({ gender: { $in: [...source.genders_to_date, 'prefer_not_to_say'] } })
		}
	}
	if (opts.requireReciprocal && source.gender && source.gender !== 'prefer_not_to_say') {
		genderFilters.push({ genders_to_date: { $in: [source.gender] } })
	}

	const pipeline: PipelineStage[] = [{ $match: initialMatch }]
	if (genderFilters.length > 0) {
		pipeline.push({ $match: { $and: genderFilters } })
	}

	// Get default latitude and longitude from city and state if they are set
	if (!source.loc_latitude && source.loc_city && source.loc_state) {
		const loc_state = source.loc_state.length <= 2 ? source.loc_state : get2LetterCodeForState('US', source.loc_state.toUpperCase())
		const latLon = getLatLonFromCityState(source.loc_city, loc_state || '')
		logger.info(String(source._id), 'Derived lat/lon from city/state:', latLon, source.loc_city, loc_state)
		if (latLon) {
			source.loc_latitude = latLon.latitude
			source.loc_longitude = latLon.longitude
		}
	}

	// Make sure candidate has answered core questions
	pipeline.push({ $match: { $and: [{ core_answers: { $exists: true, $ne: [] } }] } })
	pipeline.push({ $match: { $and: [{ core_answers: { $exists: true, $ne: ['', '', '', '', ''] } }] } })

	// Compute helper fields we need for scoring
	pipeline.push({
		$addFields: {
			// Age in years
			_ageYears: {
				$cond: [
					{ $ifNull: ['$date_of_birth', false] },
					{
						$divide: [{ $subtract: [new Date(), '$date_of_birth'] }, 1000 * 60 * 60 * 24 * 365.2425],
					},
					null,
				],
			},

			// Distance miles (Haversine; Earth's radius ~3958.8 mi)
			_distanceMiles:
				has(source.loc_latitude) && has(source.loc_longitude)
					? {
							$let: {
								vars: {
									lat1: { $degreesToRadians: source.loc_latitude },
									lon1: { $degreesToRadians: source.loc_longitude },
									lat2: { $degreesToRadians: '$loc_latitude' },
									lon2: { $degreesToRadians: '$loc_longitude' },
								},
								in: {
									$cond: [
										{ $and: [{ $ifNull: ['$loc_latitude', false] }, { $ifNull: ['$loc_longitude', false] }] },
										{
											$multiply: [
												3958.8,
												{
													$acos: {
														$add: [
															{ $multiply: [{ $sin: '$$lat1' }, { $sin: '$$lat2' }] },
															{
																$multiply: [{ $cos: '$$lat1' }, { $cos: '$$lat2' }, { $cos: { $subtract: ['$$lon2', '$$lon1'] } }],
															},
														],
													},
												},
											],
										},
										null,
									],
								},
							},
						}
					: null,

			_faithOrdinal: { $ifNull: [{ $literal: null }, FAITH_ORDER] },
			aesthetics: { $ifNull: ["$aesthetics", null] },
		},
	})

	// Fix faith ordinal mapping for candidate and source
	pipeline.push({
		$addFields: {
			_faithCandidate: {
				$switch: {
					branches: Object.entries(FAITH_ORDER).map(([k, v]) => ({
						case: { $eq: ['$faith_importance', k] },
						then: v,
					})),
					default: 0,
				},
			},
			_faithSource: {
				$switch: {
					branches: Object.entries(FAITH_ORDER).map(([k, v]) => ({
						case: { $eq: [source.faith_importance ?? 'unanswered', k] },
						then: v,
					})),
					default: 0,
				},
			},
		},
	})

	// Optional **hard** distance filter
	// const hardRadius =
	//   opts.hardDistanceMiles ??
	//   (has(source.location_radius) ? source.location_radius : null) ??
	//   null

	// if (hardRadius && has(source.loc_latitude) && has(source.loc_longitude)) {
	//   pipeline.push({
	//     $match: {
	//       _distanceMiles: { $ne: null, $lte: hardRadius }
	//     }
	//   })
	// }

	// Optional deal-breaker exclusion (symmetric)
	if (opts.excludeDealBreakerIntersect !== false) {
		pipeline.push({
			$match: {
				$expr: {
					$eq: [{ $size: { $setIntersection: [{ $ifNull: ['$deal_break_lightning', []] }, source.deal_break_lightning || []] } }, 0],
				},
			},
		})
	}

	// Build component scores
	const scoreTerms: any[] = []

	// 1) gender filter “reward” (if applied)
	if (Array.isArray(source.genders_to_date) && source.genders_to_date.length > 0) {
		scoreTerms.push({
			$cond: [{ $in: ['$gender', source.genders_to_date] }, W.genderMatch, 0],
		})
	}
	if (opts.requireReciprocal && source.gender && source.gender !== 'prefer_not_to_say') {
		scoreTerms.push({
			$cond: [{ $in: [source.gender, { $ifNull: ['$genders_to_date', []] }] }, W.reciprocalGenderBonus, 0],
		})
	}

	// 2) exact categorical matches (if source answered)
	const exactCat = <K extends keyof UserType>(field: K, weight: number) => {
		const srcVal = (source as UserType)[field]
		if (!nonUnanswered(srcVal)) return
		scoreTerms.push({
			$cond: [{ $eq: [`$${String(field)}`, srcVal] }, weight, 0],
		})
	}

	exactCat('want_kids', W.kidsExact)
	exactCat('have_kids', W.kidsExact)
	exactCat('smoking', W.smokingExact)
	exactCat('cannabis', W.cannabisExact)
	exactCat('drinking', W.drinkingExact)
	exactCat('relationship_structure', W.relationshipExact)
	exactCat('pets', W.petsExact)
	exactCat('vaccination_stance', W.vaccinationExact)
	exactCat('political_view', W.politicalExact)
	exactCat('exercise', W.exerciseExact)

	// 3) languages overlap
	if (Array.isArray(source.languages) && source.languages.length > 0) {
		pipeline.push({
			$addFields: {
				_langOverlapCount: {
					$size: {
						$setIntersection: [{ $map: { input: { $ifNull: ['$languages', []] }, as: 'l', in: { $toLower: '$$l' } } }, source.languages.map(l => String(l).toLowerCase())],
					},
				},
			},
		})
		scoreTerms.push({
			$min: [{ $multiply: ['$_langOverlapCount', W.languagesOverlapEach] }, W.languagesMax],
		})
	}

	// 3.5) pets × have_pets cross-matching
	// pets (attitude): unanswered | love | like | prefer_no | allergic
	// have_pets (ownership): unanswered | dog | cat | other | none
	if (nonUnanswered(source.pets) || nonUnanswered(source.have_pets)) {
		const srcPets = source.pets
		const srcHasPets = source.have_pets
		const hasPetsValues = ['dog', 'cat', 'other']

		// Source attitude toward pets vs. candidate's actual pets
		if (nonUnanswered(srcPets)) {
			scoreTerms.push({
				$cond: [
					// love/like + candidate has pets → full bonus
					{ $and: [{ $in: [srcPets, ['love', 'like']] }, { $in: ['$have_pets', hasPetsValues] }] },
					W.petsExact,
					{
						$cond: [
							// love + candidate has none → half penalty
							{ $and: [{ $eq: [srcPets, 'love'] }, { $eq: ['$have_pets', 'none'] }] },
							-Math.round(W.petsExact / 2),
							{
								$cond: [
									// prefer_no + candidate has pets → half penalty
									{ $and: [{ $eq: [srcPets, 'prefer_no'] }, { $in: ['$have_pets', hasPetsValues] }] },
									-Math.round(W.petsExact / 2),
									{
										$cond: [
											// allergic + candidate has pets → full penalty
											{ $and: [{ $eq: [srcPets, 'allergic'] }, { $in: ['$have_pets', hasPetsValues] }] },
											-W.petsExact,
											0,
										],
									},
								],
							},
						],
					},
				],
			})
		}

		// Source's own pets vs. candidate's attitude toward pets
		if (nonUnanswered(srcHasPets)) {
			const srcHasPetsActual = hasPetsValues.includes(srcHasPets as string)
			scoreTerms.push({
				$cond: [
					// candidate loves/likes pets and source has pets → full bonus
					{ $and: [{ $in: ['$pets', ['love', 'like']] }, { $literal: srcHasPetsActual }] },
					W.petsExact,
					{
						$cond: [
							// candidate is allergic and source has pets → full penalty
							{ $and: [{ $eq: ['$pets', 'allergic'] }, { $literal: srcHasPetsActual }] },
							-W.petsExact,
							{
								$cond: [
									// candidate prefers no pets and source has pets → half penalty
									{ $and: [{ $eq: ['$pets', 'prefer_no'] }, { $literal: srcHasPetsActual }] },
									-Math.round(W.petsExact / 2),
									0,
								],
							},
						],
					},
				],
			})
		}
	}

	// 3.6 religion proximity
	if (nonUnanswered(source.religion)) {
		pipeline.push({
			$addFields: {
				_religionMatch: {
					$cond: [{ $eq: ['$religion', source.religion] }, 1, 0],
				},
			},
		})
		scoreTerms.push({
			$multiply: [W.faithProximity, { $ifNull: ['$_religionMatch', 0] }],
		})
	}

	// 3.7 have_kids and want_kids proximity
	if (nonUnanswered(source.have_kids) || nonUnanswered(source.want_kids)) {
		pipeline.push({
			$addFields: {
				_kidsMatch: {
					$cond: [
						{ $eq: ['$have_kids', source.have_kids] },
						1,
						{
							$cond: [{ $eq: ['$want_kids', source.want_kids] }, 1, 0],
						},
					],
				},
			},
		})
		scoreTerms.push({
			$multiply: [W.kidsExact, { $ifNull: ['$_kidsMatch', 0] }],
		})
	}

	// 3.8 education proximity
	if (nonUnanswered(source.education)) {
		pipeline.push({
			$addFields: {
				_educationMatch: {
					$cond: [{ $eq: ['$education', source.education] }, 1, 0],
				},
			},
		})
		scoreTerms.push({
			$multiply: [W.faithProximity, { $ifNull: ['$_educationMatch', 0] }],
		})
	}

	// 4.a) age proximity (if source has DOB)
	const sourceAgeYears = source.date_of_birth ? (Date.now() - new Date(source.date_of_birth).getTime()) / (1000 * 60 * 60 * 24 * 365.2425) : null

	if (sourceAgeYears !== null) {
		pipeline.push({
			$addFields: {
				_ageDelta: {
					$cond: [{ $ifNull: ['$_ageYears', false] }, { $abs: { $subtract: [sourceAgeYears, '$_ageYears'] } }, null],
				},
			},
		})
		// Full weight if |Δage| <= 2; linearly fades to 0 at 12+ years difference
		scoreTerms.push({
			$cond: [
				{ $and: [{ $ne: ['$_ageDelta', null] }, { $lte: ['$_ageDelta', 12] }] },
				{
					$multiply: [
						W.ageProximity,
						{
							$max: [0, { $subtract: [1, { $divide: [{ $max: [0, { $subtract: ['$_ageDelta', 2] }] }, 10] }] }],
						},
					],
				},
				0,
			],
		})
	}

	// 4.b) when below 30 years old, allow only candidates also below 30
	const sourceAgeBelow30 = sourceAgeYears !== null && sourceAgeYears < 30
	if (sourceAgeBelow30) {
		pipeline.push({
			$match: {
				_ageYears: { $lt: 30 },
			},
		})
	}

	// 5) faith proximity (ordinal closeness)
	if (nonUnanswered(source.faith_importance)) {
		pipeline.push({
			$addFields: {
				_faithDelta: { $abs: { $subtract: ['$_faithCandidate', '$_faithSource'] } },
			},
		})
		// Full points if same; 75% if 1 step away; 0 by 3+ steps
		scoreTerms.push({
			$cond: [
				{ $lte: ['$_faithDelta', 3] },
				{
					$multiply: [W.faithProximity, { $max: [0, { $subtract: [1, { $divide: ['$_faithDelta', 3] }] }] }],
				},
				0,
			],
		})
	}

	// 6) distance proximity (soft scoring)
	// const softRadius = (has(source.location_radius) ? source.location_radius : 50)
	// if (has(source.loc_latitude) && has(source.loc_longitude)) {
	//   // full points within 5 miles, fades to 0 by softRadius
	//   scoreTerms.push({
	//     $cond: [
	//       { $and: [{ $ifNull: ['$_distanceMiles', false] }, { $lte: ['$_distanceMiles', softRadius] }] },
	//       {
	//         $multiply: [
	//           W.distanceProximity,
	//           {
	//             $max: [
	//               0,
	//               {
	//                 $subtract: [
	//                   1,
	//                   {
	//                     $divide: [
	//                       { $max: [0, { $subtract: ['$_distanceMiles', 5] }] },
	//                       Math.max(1, (softRadius || 0) - 5)
	//                     ]
	//                   }
	//                 ]
	//               }
	//             ]
	//           }
	//         ]
	//       },
	//       0
	//     ]
	//   })
	// }

	// 7 high_priority_values proximity (overlap)
	if (Array.isArray(source.high_priority_values) && source.high_priority_values.length > 0) {
		pipeline.push({
			$addFields: {
				_highPriorityOverlapCount: {
					$size: {
						$setIntersection: [
							{ $map: { input: { $ifNull: ['$high_priority_values', []] }, as: 'l', in: { $toLower: '$$l' } } },
							source.high_priority_values.map(l => String(l).toLowerCase()),
						],
					},
				},
			},
		})
		scoreTerms.push({
			$multiply: [{ $ifNull: ['$_highPriorityOverlapCount', 0] }, W.highPriorityValuesOverlapEach],
		})
	}

	// 7.5) if includeTestUsers is true, give a small bonus to non-test users to help them surface in results
	if (opts.includeTestUsers === true) {
		scoreTerms.push({
			$cond: [{ $eq: ['$_isTestUser', false] }, W.nonTestUserBonus, 0],
		})
	}

	// 8) preference-based scoring (only when user.preferences contains values)
	const prefAgeMin = toFiniteNumber(preferences.age_min)
	const prefAgeMax = toFiniteNumber(preferences.age_max)
	if (prefAgeMin !== null || prefAgeMax !== null) {
		if (usePreferenceScoring) {
			scoreTerms.push({
				$cond: [
					{
						$and: [
							{ $ne: ['$_ageYears', null] },
							...(prefAgeMin !== null ? [{ $gte: ['$_ageYears', prefAgeMin] }] : []),
							...(prefAgeMax !== null ? [{ $lte: ['$_ageYears', prefAgeMax] }] : []),
						],
					},
					W.preferenceAgeRange,
					0,
				],
			})
		} else {
			pipeline.push({
				$match: {
					_ageYears: {
						...(prefAgeMin !== null ? { $gte: prefAgeMin } : {}),
						...(prefAgeMax !== null ? { $lte: prefAgeMax } : {}),
					},
				},
			})
		}
	}

	const prefDistanceMax = toFiniteNumber(preferences.distance_max)
	if (prefDistanceMax !== null && prefDistanceMax > 0) {
		if (usePreferenceScoring) {
			scoreTerms.push({
				$cond: [
					{
						$and: [{ $ne: ['$_distanceMiles', null] }, { $lte: ['$_distanceMiles', prefDistanceMax] }],
					},
					W.preferenceDistance,
					0,
				],
			})
		} else {
			pipeline.push({
				$match: {
					_distanceMiles: { $ne: null, $lte: prefDistanceMax },
				},
			})
		}
	}

	const prefHeightMin = toFiniteNumber(preferences.height_min)
	const prefHeightMax = toFiniteNumber(preferences.height_max)
	if (prefHeightMin !== null || prefHeightMax !== null) {
		pipeline.push({
			$addFields: {
				_heightCm: {
					$convert: {
						input: '$height',
						to: 'double',
						onError: null,
						onNull: null,
					},
				},
			},
		})

		if (usePreferenceScoring) {
			scoreTerms.push({
				$cond: [
					{
						$and: [
							{ $ne: ['$_heightCm', null] },
							...(prefHeightMin !== null ? [{ $gte: ['$_heightCm', prefHeightMin] }] : []),
							...(prefHeightMax !== null ? [{ $lte: ['$_heightCm', prefHeightMax] }] : []),
						],
					},
					W.preferenceHeightRange,
					0,
				],
			})
		} else {
			pipeline.push({
				$match: {
					_heightCm: {
						...(prefHeightMin !== null ? { $gte: prefHeightMin } : {}),
						...(prefHeightMax !== null ? { $lte: prefHeightMax } : {}),
					},
				},
			})
		}
	}

	const prefExact = <K extends keyof UserType>(field: K, prefValue: unknown, weight: number) => {
		const prefValues = normalizedPreferenceValues(prefValue)
		if (prefValues.length === 0) return
		if (usePreferenceScoring) {
			scoreTerms.push({
				$cond: [{ $in: [`$${String(field)}`, prefValues] }, weight, 0],
			})
		} else {
			pipeline.push({
				$match: {
					[String(field)]: { $in: prefValues },
				},
			})
		}
	}

	prefExact('exercise', preferences.exercise, W.preferenceExact)
	prefExact('have_kids', preferences.have_kids, W.preferenceExact)
	prefExact('smoking', preferences.smoking, W.preferenceExact)
	prefExact('cannabis', preferences.cannabis, W.preferenceExact)
	prefExact('relationship_structure', preferences.relationship_structure, W.preferenceExact)
	prefExact('drinking', preferences.drinking, W.preferenceExact)
	prefExact('political_view', preferences.political_view, W.preferenceExact)

	const preferredPets = normalizedPreferenceValues(preferences.pets)
	if (preferredPets.length > 0) {
		if (usePreferenceScoring) {
			scoreTerms.push({
				$cond: [{ $in: ['$have_pets', preferredPets] }, W.preferenceExact, 0],
			})
		} else {
			pipeline.push({
				$match: {
					have_pets: { $in: preferredPets },
				},
			})
		}
	}

	// aesthetics boost — linearly decays from aestheticsBoost to minimumAestheticsBoost
	// over the first 2 weeks after createdAt; stays at minimum beyond that
	const twoWeeksMs = 14 * 24 * 60 * 60 * 1000
	scoreTerms.push({
		$cond: [
			{ $and: [{ $ne: ['$aesthetics', null] }, { $ifNull: ['$createdAt', false] }] },
			{
				$multiply: [
					{ $divide: ['$aesthetics', 100] },
					{
						$add: [
							W.minimumAestheticsBoost,
							{
								$multiply: [
									W.aestheticsBoost - W.minimumAestheticsBoost,
									{
										$max: [
											0,
											{
												$subtract: [
													1,
													{ $divide: [{ $subtract: [new Date(), '$createdAt'] }, twoWeeksMs] },
												],
											},
										],
									},
								],
							},
						],
					},
				],
			},
			0,
		],
	})

	// Final score & sort
	pipeline.push({
		$addFields: {
			_score: { $sum: scoreTerms },
		},
	})

	pipeline.push({ $sort: { _score: -1, createdAt: -1 } })

	// Shape the output
	pipeline.push({
		$project: {
			password: 0,
			email: 0,
			phone: 0,
			loc_address: 0,
			loc_postal_code: 0,
			loc_latitude: 0,
			loc_longitude: 0,
			date_of_birth: 0,
			is_admin: 0,
			is_banned: 0,
			is_test_user: 0,
			_faithOrdinal: 0,
			_faithCandidate: 0,
			_faithSource: 0,
			_heightCm: 0,
			aesthetics: 0,
		},
	})

	return pipeline
}

// 1) weights: replace ageGapMax with ageProximityClose
const defaultWorstWeights = () => ({
	dealBreakerIntersectEach: 15,
	highPriorityValuesMismatchEach: 6,
	kidsDifferent: 8,
	kidsStrongConflict: 12,
	smokingDifferent: 8,
	cannabisDifferent: 8,
	smokingOpposite: 12,
	cannabisOpposite: 12,
	drinkingDifferent: 8,
	drinkingOpposite: 12,
	exerciseDifferent: 6,
	exerciseOppossite: 12,
	relationshipDifferent: 6,
	relationshipOpposite: 12,
	petsDifferent: 6,
	petsStrongConflict: 10,
	vaccinationDifferent: 8,
	politicalDifferent: 6,

	faithDistanceMax: 8,

	// NEW: age proximity reduces badness when close
	ageProximityClose: 10, // full subtraction if |Δage|<=2, fades to 0 by 12
	ageGapMax: 12, // for above fading

	languagesNoOverlapBonus: 10,
	languagesPenaltyPerOverlap: 3,
	distanceWithinRadiusMax: 6,

	preferenceAgeOutOfRange: 10,
	preferenceDistanceOutOfRange: 12,
	preferenceHeightOutOfRange: 6,
	preferenceMismatch: 6,
})

interface WorstOpts {
	/** require reciprocal interest (both ways) */
	requireReciprocal?: boolean
	/** candidates to exclude from results */
	avoidDuplicateIds?: Set<mongoose.Types.ObjectId | string>
	/** hard max miles; defaults to source.location_radius or 50 */
	hardDistanceMiles?: number | null
	/** include test users? default false */
	includeTestUsers?: boolean
	/** include only test users default false */
	includeOnlyTestUsers?: boolean
	/** weights override */
	weights?: Partial<ReturnType<typeof defaultWorstWeights>>
}

export function getLatLonFromCityState(city: string, state: string): { latitude: number; longitude: number } | null {
	if (!city || !state) return null
	const cityState = `${city}, ${state}`.toLowerCase()
	const cityStateData = (cityStateDataByCityState as Record<string, { latitude: number; longitude: number }>)[cityState]
	if (!cityStateData) return null
	return { latitude: cityStateData.latitude, longitude: cityStateData.longitude }
}

export function buildWorstDatePipeline(source: UserType | LeanDocument<UserType>, opts: WorstOpts = {}): PipelineStage[] {
	const W = { ...defaultWorstWeights(), ...(opts.weights || {}) }
	const preferences = source.preferences || {}

	const has = (v: any) => v !== undefined && v !== null
	const answered = (v?: string | null) => has(v) && v !== 'unanswered'
	const normalizedPreferenceValues = (value: unknown): string[] => {
		const values = Array.isArray(value) ? value : value !== undefined && value !== null ? [value] : []
		return values.filter((v): v is string => typeof v === 'string' && v !== 'unanswered')
	}
	const toFiniteNumber = (v: unknown): number | null => {
		if (typeof v === 'number' && Number.isFinite(v)) return v
		if (typeof v === 'string') {
			const n = Number(v)
			return Number.isFinite(n) ? n : null
		}
		return null
	}

	const initialMatch: Record<string, any> = {
		is_banned: { $ne: true },
		is_admin: { $ne: true },
		_id: { $ne: new mongoose.Types.ObjectId(String(source._id)) },
		in_relationship_with: null,
	}
	if (opts.avoidDuplicateIds && opts.avoidDuplicateIds.size > 0) {
		initialMatch._id = {
			...(initialMatch._id || {}),
			$nin: Array.from(opts.avoidDuplicateIds).map(id => new mongoose.Types.ObjectId(id)),
		}
	}
	if (!opts.includeTestUsers) initialMatch.is_test_user = { $ne: true }
	if (opts.includeOnlyTestUsers) initialMatch.is_test_user = true

	// enforce gender compatibility
	const genderClauses: any[] = []
	if (Array.isArray(source.genders_to_date) && source.genders_to_date.length > 0) {
		genderClauses.push({ gender: { $in: source.genders_to_date } })
	}
	if (opts.requireReciprocal && source.gender && source.gender !== 'prefer_not_to_say') {
		genderClauses.push({ genders_to_date: source.gender })
	}

	const pipeline: PipelineStage[] = [{ $match: initialMatch }]
	if (genderClauses.length > 0) pipeline.push({ $match: { $and: genderClauses } })

	if (!source.loc_latitude && source.loc_city && source.loc_state) {
		const latLon = getLatLonFromCityState(source.loc_city, source.loc_state)
		if (latLon) {
			source.loc_latitude = latLon.latitude
			source.loc_longitude = latLon.longitude
		}
	}
	// compute distance (Haversine)
	const haveSrcCoords = has(source.loc_latitude) && has(source.loc_longitude)
	pipeline.push({
		$addFields: {
			_ageYears: {
				$cond: [{ $ifNull: ['$date_of_birth', false] }, { $divide: [{ $subtract: [new Date(), '$date_of_birth'] }, 1000 * 60 * 60 * 24 * 365.2425] }, null],
			},
			_distanceMiles: haveSrcCoords
				? {
						$let: {
							vars: {
								lat1: { $degreesToRadians: source.loc_latitude },
								lon1: { $degreesToRadians: source.loc_longitude },
								lat2: { $degreesToRadians: '$loc_latitude' },
								lon2: { $degreesToRadians: '$loc_longitude' },
							},
							in: {
								$cond: [
									{ $and: [{ $ifNull: ['$loc_latitude', false] }, { $ifNull: ['$loc_longitude', false] }] },
									{
										$multiply: [
											3958.8,
											{
												$acos: {
													$add: [
														{ $multiply: [{ $sin: '$$lat1' }, { $sin: '$$lat2' }] },
														{
															$multiply: [{ $cos: '$$lat1' }, { $cos: '$$lat2' }, { $cos: { $subtract: ['$$lon2', '$$lon1'] } }],
														},
													],
												},
											},
										],
									},
									null,
								],
							},
						},
					}
				: null,
		},
	})

	// hard distance filter (enforce location match)
	const hardRadius = opts.hardDistanceMiles ?? (has(source.location_radius) ? source.location_radius : 50)

	if (haveSrcCoords && hardRadius) {
		pipeline.push({ $match: { _distanceMiles: { $ne: null, $lte: hardRadius } } })
	}

	// helper computed fields
	const sourceAgeYears = source.date_of_birth ? (Date.now() - new Date(source.date_of_birth).getTime()) / (1000 * 60 * 60 * 24 * 365.2425) : null

	// faith ordinals
	pipeline.push({
		$addFields: {
			_faithCandidate: {
				$switch: {
					branches: Object.entries(FAITH_ORDER).map(([k, v]) => ({
						case: { $eq: ['$faith_importance', k] },
						then: v,
					})),
					default: 0,
				},
			},
			_faithSource: {
				$switch: {
					branches: Object.entries(FAITH_ORDER).map(([k, v]) => ({
						case: { $eq: [source.faith_importance ?? 'unanswered', k] },
						then: v,
					})),
					default: 0,
				},
			},
		},
	})

	// languages overlap
	if (Array.isArray(source.languages) && source.languages.length > 0) {
		pipeline.push({
			$addFields: {
				_langOverlap: {
					$size: {
						$setIntersection: [{ $map: { input: { $ifNull: ['$languages', []] }, as: 'l', in: { $toLower: '$$l' } } }, source.languages.map(l => String(l).toLowerCase())],
					},
				},
			},
		})
	}

	const badTerms: any[] = []

	// 1) deal breakers (more intersect = worse)
	badTerms.push({
		$multiply: [
			W.dealBreakerIntersectEach,
			{
				$size: {
					$setIntersection: [{ $ifNull: ['$deal_break_lightning', []] }, source.deal_break_lightning || []],
				},
			},
		],
	})

	// 2) categorical differences
	const diff = (field: keyof UserType, weightDifferent: number, strongPairs?: Array<[string, string, number]>) => {
		const src = (source as UserType)[field]
		if (!answered(src)) return
		// base “different” points
		badTerms.push({
			$cond: [{ $and: [{ $ne: [`$${String(field)}`, src] }, { $ne: [`$${String(field)}`, 'unanswered'] }] }, weightDifferent, 0],
		})
		// strong conflict specific pairs (orderless)
		;(strongPairs || []).forEach(([a, b, w]) => {
			badTerms.push({
				$cond: [
					{
						$or: [{ $and: [{ $eq: [src, a] }, { $eq: [`$${String(field)}`, b] }] }, { $and: [{ $eq: [src, b] }, { $eq: [`$${String(field)}`, a] }] }],
					},
					w,
					0,
				],
			})
		})
	}

	diff('want_kids', W.kidsDifferent, [['yes', 'no', W.kidsStrongConflict]])
	diff('have_kids', W.kidsDifferent, [['yes', 'no', W.kidsStrongConflict]])
	diff('smoking', W.smokingDifferent, [['never', 'regularly', W.smokingOpposite]])
	diff('cannabis', W.cannabisDifferent, [['never', 'regularly', W.cannabisOpposite]])
	diff('drinking', W.drinkingDifferent, [['no', 'regularly', W.drinkingOpposite]])
	diff('relationship_structure', W.relationshipDifferent, [['short_term_relationship', 'long_term_relationship', W.relationshipOpposite]])
	diff('pets', W.petsDifferent, [['allergic', 'love', W.petsStrongConflict]])
	diff('exercise', W.exerciseDifferent, [['never', 'daily', W.exerciseOppossite]])

	// vaccination stance different
	if (answered(source.vaccination_stance)) {
		badTerms.push({
			$cond: [
				{
					$and: [{ $ne: ['$vaccination_stance', source.vaccination_stance] }, { $ne: ['$vaccination_stance', 'unanswered'] }],
				},
				W.vaccinationDifferent,
				0,
			],
		})
	}

	// political different (ignore 'unanswered' neutrality)
	if (answered(source.political_view) && source.political_view !== 'unanswered') {
		badTerms.push({
			$cond: [
				{
					$and: [{ $ne: ['$political_view', source.political_view] }, { $ne: ['$political_view', 'unanswered'] }],
				},
				W.politicalDifferent,
				0,
			],
		})
	}

	// 3) faith distance — farther is worse (up to 4 steps)
	if (answered(source.faith_importance)) {
		pipeline.push({
			$addFields: { _faithDelta: { $abs: { $subtract: ['$_faithCandidate', '$_faithSource'] } } },
		})
		badTerms.push({
			$cond: [{ $ne: ['_faithDelta', null] }, { $min: [{ $multiply: ['$_faithDelta', W.faithDistanceMax / 4] }, W.faithDistanceMax] }, 0],
		})
	}

	// 4) age gap — larger is worse (cap at 25 yrs)
	if (sourceAgeYears !== null) {
		pipeline.push({
			$addFields: {
				_ageDelta: {
					$cond: [{ $ifNull: ['$_ageYears', false] }, { $abs: { $subtract: [sourceAgeYears, '$_ageYears'] } }, null],
				},
			},
		})
		badTerms.push({
			$cond: [
				{ $ne: ['$_ageDelta', null] },
				{
					$min: [{ $multiply: [{ $divide: [{ $min: ['$_ageDelta', 25] }, 25] }, W.ageGapMax] }, W.ageGapMax],
				},
				0,
			],
		})
	}

	// 5) languages — fewer overlaps are worse
	if (Array.isArray(source.languages) && source.languages.length > 0) {
		badTerms.push({
			$add: [
				{ $cond: [{ $eq: ['$_langOverlap', 0] }, W.languagesNoOverlapBonus, 0] },
				{ $multiply: [-1, { $min: ['$_langOverlap', 3] }, W.languagesPenaltyPerOverlap] }, // subtract badness for overlaps
			],
		})
	}

	// 6) distance — farther within allowed radius is “worse”
	// if (haveSrcCoords && hardRadius) {
	//   badTerms.push({
	//     $cond: [
	//       { $and: [{ $ifNull: ['$_distanceMiles', false] }, { $lte: ['$_distanceMiles', hardRadius] }] },
	//       {
	//         $multiply: [
	//           W.distanceWithinRadiusMax,
	//           { $max: [0, { $divide: ['$_distanceMiles', hardRadius] }] } // near 0mi→0, near edge→max
	//         ]
	//       },
	//       0
	//     ]
	//   })
	// }

	// 7) high_priority_values - any overlap is bad
	if (Array.isArray(source.high_priority_values) && source.high_priority_values.length > 0) {
		pipeline.push({
			$addFields: {
				_highPriorityOverlapCount: {
					$size: {
						$setIntersection: [
							{ $map: { input: { $ifNull: ['$high_priority_values', []] }, as: 'l', in: { $toLower: '$$l' } } },
							source.high_priority_values.map(l => String(l).toLowerCase()),
						],
					},
				},
			},
		})
		badTerms.push({
			$cond: [{ $gt: ['$_highPriorityOverlapCount', 0] }, { $multiply: ['$_highPriorityOverlapCount', W.highPriorityValuesMismatchEach] }, 0],
		})
	}

	// 8) preference-based badness scoring (only when user.preferences contains values)
	// NOTE: All user.preferences in buildWorstDatePipeline are ALWAYS scored as soft penalties,
	// never applied as hard $match filters. This ensures candidates can always be returned
	// even if they don't fully match all preference criteria.
	const prefAgeMin = toFiniteNumber(preferences.age_min)
	const prefAgeMax = toFiniteNumber(preferences.age_max)
	if (prefAgeMin !== null || prefAgeMax !== null) {
		badTerms.push({
			$cond: [
				{
					$and: [
						{ $ne: ['$_ageYears', null] },
						{
							$or: [...(prefAgeMin !== null ? [{ $lt: ['$_ageYears', prefAgeMin] }] : []), ...(prefAgeMax !== null ? [{ $gt: ['$_ageYears', prefAgeMax] }] : [])],
						},
					],
				},
				W.preferenceAgeOutOfRange,
				0,
			],
		})
	}

	const prefDistanceMax = toFiniteNumber(preferences.distance_max)
	if (prefDistanceMax !== null) {
		badTerms.push({
			$cond: [
				{
					$and: [{ $ne: ['$_distanceMiles', null] }, { $gt: ['$_distanceMiles', prefDistanceMax] }],
				},
				W.preferenceDistanceOutOfRange,
				0,
			],
		})
	}

	const prefHeightMin = toFiniteNumber(preferences.height_min)
	const prefHeightMax = toFiniteNumber(preferences.height_max)
	if (prefHeightMin !== null || prefHeightMax !== null) {
		pipeline.push({
			$addFields: {
				_heightCm: {
					$convert: {
						input: '$height',
						to: 'double',
						onError: null,
						onNull: null,
					},
				},
			},
		})

		badTerms.push({
			$cond: [
				{
					$and: [
						{ $ne: ['$_heightCm', null] },
						{ $or: [...(prefHeightMin !== null ? [{ $lt: ['$_heightCm', prefHeightMin] }] : []), ...(prefHeightMax !== null ? [{ $gt: ['$_heightCm', prefHeightMax] }] : [])] },
					],
				},
				W.preferenceHeightOutOfRange,
				0,
			],
		})
	}

	const prefMismatch = <K extends keyof UserType>(field: K, prefValue: unknown, weight: number) => {
		const prefValues = normalizedPreferenceValues(prefValue)
		if (prefValues.length === 0) return
		badTerms.push({
			$cond: [{ $and: [{ $not: { $in: [`$${String(field)}`, prefValues] } }, { $ne: [`$${String(field)}`, 'unanswered'] }] }, weight, 0],
		})
	}

	prefMismatch('exercise', preferences.exercise, W.preferenceMismatch)
	prefMismatch('have_kids', preferences.have_kids, W.preferenceMismatch)
	prefMismatch('smoking', preferences.smoking, W.preferenceMismatch)
	prefMismatch('cannabis', preferences.cannabis, W.preferenceMismatch)
	prefMismatch('relationship_structure', preferences.relationship_structure, W.preferenceMismatch)
	prefMismatch('drinking', preferences.drinking, W.preferenceMismatch)
	prefMismatch('political_view', preferences.political_view, W.preferenceMismatch)

	const preferredPets = normalizedPreferenceValues(preferences.pets)
	if (preferredPets.length > 0) {
		badTerms.push({
			$cond: [{ $and: [{ $not: { $in: ['$have_pets', preferredPets] } }, { $ne: ['$have_pets', 'unanswered'] }] }, W.preferenceMismatch, 0],
		})
	}

	// final badness score & sort (desc = worst first)
	pipeline.push({
		$addFields: { _badScore: { $sum: badTerms } },
	})
	pipeline.push({ $sort: { _badScore: -1, createdAt: -1 } })

	// project
	pipeline.push({
		$project: {
			password: 0,
			phone: 0,
			email: 0,
			loc_address: 0,
			loc_postal_code: 0,
			loc_latitude: 0,
			loc_longitude: 0,
			date_of_birth: 0,
			is_admin: 0,
			is_banned: 0,
			is_test_user: 0,
			_heightCm: 0,
		},
	})

	return pipeline
}

export function get2LetterCodeForState(country: string, fullNameState: string) {
	const stateTo2LetterCode: Record<string, string> = {
		ALABAMA: 'AL',
		ALASKA: 'AK',
		ARIZONA: 'AZ',
		ARKANSAS: 'AR',
		CALIFORNIA: 'CA',
		COLORADO: 'CO',
		CONNECTICUT: 'CT',
		DELAWARE: 'DE',
		FLORIDA: 'FL',
		GEORGIA: 'GA',
		HAWAII: 'HI',
		IDAHO: 'ID',
		ILLINOIS: 'IL',
		INDIANA: 'IN',
		IOWA: 'IA',
		KANSAS: 'KS',
		KENTUCKY: 'KY',
		LOUISIANA: 'LA',
		MAINE: 'ME',
		MARYLAND: 'MD',
		MASSACHUSETTS: 'MA',
		MICHIGAN: 'MI',
		MINNESOTA: 'MN',
		MISSISSIPPI: 'MS',
		MISSOURI: 'MO',
		MONTANA: 'MT',
		NEBRASKA: 'NE',
		NEVADA: 'NV',
		'NEW HAMPSHIRE': 'NH',
		'NEW JERSEY': 'NJ',
		'NEW MEXICO': 'NM',
		'NEW YORK': 'NY',
		'NORTH CAROLINA': 'NC',
		'NORTH DAKOTA': 'ND',
		OHIO: 'OH',
		OKLAHOMA: 'OK',
		OREGON: 'OR',
		PENNSYLVANIA: 'PA',
		'RHODE ISLAND': 'RI',
		'SOUTH CAROLINA': 'SC',
		'SOUTH DAKOTA': 'SD',
		TENNESSEE: 'TN',
		TEXAS: 'TX',
		UTAH: 'UT',
		VERMONT: 'VT',
		VIRGINIA: 'VA',
		WASHINGTON: 'WA',
		'WEST VIRGINIA': 'WV',
		WISCONSIN: 'WI',
		WYOMING: 'WY',
	}
	const canadaStateTo2LetterCode: Record<string, string> = {
		ALBERTA: 'AB',
		'BRITISH COLUMBIA': 'BC',
		MANITOBA: 'MB',
		'NEW BRUNSWICK': 'NB',
		'NEWFOUNDLAND AND LABRADOR': 'NL',
		'NOVA SCOTIA': 'NS',
		ONTARIO: 'ON',
		'PRINCE EDWARD ISLAND': 'PE',
		QUEBEC: 'QC',
		SASKATCHEWAN: 'SK',
		'NORTHWEST TERRITORIES': 'NT',
		NUNAVUT: 'NU',
		YUKON: 'YT',
	}
	switch (country) {
		case 'US':
			return stateTo2LetterCode[fullNameState]
		case 'CA':
			return canadaStateTo2LetterCode[fullNameState]
		default:
			return null
	}
}
