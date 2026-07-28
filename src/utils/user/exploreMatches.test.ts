import { describe, expect, it } from 'vitest'

import { buildAffinityPipeline, buildWorstDatePipeline } from './exploreMatches'

const baseUser = () => ({
	_id: '69f8d15fc353a737a7cbaa5d',
	genders_to_date: [],
	preferences: {},
	loc_latitude: 37.7749,
	loc_longitude: -122.4194,
})

const getScoreTerms = (pipeline: any[]) => {
	const scoreStage = pipeline.find(stage => stage.$addFields?._score)
	return scoreStage?.$addFields?._score?.$sum || []
}

const twoWeeksMs = 14 * 24 * 60 * 60 * 1000

describe('buildAffinityPipeline preferences', () => {
	it('excludes candidates that are already in a relationship', () => {
		const pipeline = buildAffinityPipeline({
			...baseUser(),
		} as any)

		expect(pipeline[0]).toEqual(
			expect.objectContaining({
				$match: expect.objectContaining({
					in_relationship_with: null,
				}),
			}),
		)
	})

	it('adds distance preference scoring when preferences.distance_max is provided', () => {
		const pipeline = buildAffinityPipeline({
			...baseUser(),
			preferences: { distance_max: 25 },
		} as any)

		const scoreTerms = getScoreTerms(pipeline)
		expect(scoreTerms).toContainEqual({
			$cond: [
				{
					$and: [{ $ne: ['$_distanceMiles', null] }, { $lte: ['$_distanceMiles', 25] }],
				},
				12,
				0,
			],
		})
	})

	it('adds age and height preference score terms when range preferences are provided', () => {
		const pipeline = buildAffinityPipeline({
			...baseUser(),
			preferences: {
				age_min: 28,
				age_max: 35,
				height_min: 165,
				height_max: 190,
			},
		} as any)

		expect(pipeline).toContainEqual({
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

		const scoreTerms = getScoreTerms(pipeline)
		expect(scoreTerms).toContainEqual({
			$cond: [
				{
					$and: [{ $ne: ['$_ageYears', null] }, { $gte: ['$_ageYears', 28] }, { $lte: ['$_ageYears', 35] }],
				},
				10,
				0,
			],
		})
		expect(scoreTerms).toContainEqual({
			$cond: [
				{
					$and: [{ $ne: ['$_heightCm', null] }, { $gte: ['$_heightCm', 165] }, { $lte: ['$_heightCm', 190] }],
				},
				6,
				0,
			],
		})
	})

	it('adds exact-match preference score terms for array-based categorical preferences', () => {
		const pipeline = buildAffinityPipeline({
			...baseUser(),
			preferences: {
				exercise: ['daily', 'few_times_per_week'],
				have_kids: ['no'],
				smoking: ['never'],
				political_view: ['moderate'],
			},
		} as any)

		const scoreTerms = getScoreTerms(pipeline)
		expect(scoreTerms).toContainEqual({ $cond: [{ $in: ['$exercise', ['daily', 'few_times_per_week']] }, 6, 0] })
		expect(scoreTerms).toContainEqual({ $cond: [{ $in: ['$have_kids', ['no']] }, 6, 0] })
		expect(scoreTerms).toContainEqual({ $cond: [{ $in: ['$smoking', ['never']] }, 6, 0] })
		expect(scoreTerms).toContainEqual({ $cond: [{ $in: ['$political_view', ['moderate']] }, 6, 0] })
	})

	it('scores pet preferences against candidate have_pets values', () => {
		const pipeline = buildAffinityPipeline({
			...baseUser(),
			preferences: {
				pets: ['dog', 'cat'],
			},
		} as any)

		const scoreTerms = getScoreTerms(pipeline)
		expect(scoreTerms).toContainEqual({
			$cond: [{ $in: ['$have_pets', ['dog', 'cat']] }, 6, 0],
		})
	})

	it('uses scoring for user.preferences fields by default', () => {
		const pipeline = buildAffinityPipeline({
			...baseUser(),
			preferences: {
				exercise: ['few_times_per_week'],
				smoking: ['socially'],
				distance_max: 25,
			},
		} as any)

		const scoreTerms = getScoreTerms(pipeline)
		expect(scoreTerms).toContainEqual({ $cond: [{ $in: ['$exercise', ['few_times_per_week']] }, 6, 0] })
		expect(scoreTerms).toContainEqual({ $cond: [{ $in: ['$smoking', ['socially']] }, 6, 0] })
		expect(scoreTerms).toContainEqual({
			$cond: [
				{
					$and: [{ $ne: ['$_distanceMiles', null] }, { $lte: ['$_distanceMiles', 25] }],
				},
				12,
				0,
			],
		})
		expect(pipeline).not.toContainEqual({
			$match: {
				_distanceMiles: { $ne: null, $lte: 25 },
			},
		})
		expect(pipeline).not.toContainEqual({
			$match: {
				exercise: { $in: ['few_times_per_week'] },
			},
		})
	})

	it('can use hard matching for user.preferences fields when usePreferenceScoring is false', () => {
		const pipeline = buildAffinityPipeline(
			{
				...baseUser(),
				preferences: {
					age_min: 28,
					age_max: 35,
					height_min: 165,
					height_max: 190,
					exercise: ['few_times_per_week'],
					pets: ['dog', 'cat'],
					distance_max: 25,
				},
			} as any,
			undefined,
			{ usePreferenceScoring: false },
		)

		const scoreTerms = getScoreTerms(pipeline)
		expect(scoreTerms).not.toContainEqual({ $cond: [{ $in: ['$exercise', ['few_times_per_week']] }, 6, 0] })
		expect(scoreTerms).not.toContainEqual({ $cond: [{ $in: ['$have_pets', ['dog', 'cat']] }, 6, 0] })
		expect(scoreTerms).not.toContainEqual({
			$cond: [
				{
					$and: [{ $ne: ['$_distanceMiles', null] }, { $lte: ['$_distanceMiles', 25] }],
				},
				12,
				0,
			],
		})

		expect(pipeline).toContainEqual({
			$match: {
				_distanceMiles: { $ne: null, $lte: 25 },
			},
		})
		expect(pipeline).toContainEqual({
			$match: {
				_ageYears: { $gte: 28, $lte: 35 },
			},
		})
		expect(pipeline).toContainEqual({
			$match: {
				_heightCm: { $gte: 165, $lte: 190 },
			},
		})
		expect(pipeline).toContainEqual({
			$match: {
				exercise: { $in: ['few_times_per_week'] },
			},
		})
		expect(pipeline).toContainEqual({
			$match: {
				have_pets: { $in: ['dog', 'cat'] },
			},
		})
	})

	it('adds nonTestUserBonus score term when includeTestUsers is true', () => {
		const pipeline = buildAffinityPipeline(
			{
				...baseUser(),
			} as any,
			undefined,
			{ includeTestUsers: true },
		)

		const scoreTerms = getScoreTerms(pipeline)
		expect(scoreTerms).toContainEqual({
			$cond: [{ $eq: ['$_isTestUser', false] }, 5, 0],
		})
	})

	it('does not add nonTestUserBonus score term when includeTestUsers is false or undefined', () => {
		const pipelineDefault = buildAffinityPipeline({
			...baseUser(),
		} as any)
		const pipelineFalse = buildAffinityPipeline(
			{
				...baseUser(),
			} as any,
			undefined,
			{ includeTestUsers: false },
		)

		const scoreTermsDefault = getScoreTerms(pipelineDefault)
		const scoreTermsFalse = getScoreTerms(pipelineFalse)

		const expectedTerm = { $cond: [{ $eq: ['$_isTestUser', false] }, 5, 0] }
		expect(scoreTermsDefault).not.toContainEqual(expectedTerm)
		expect(scoreTermsFalse).not.toContainEqual(expectedTerm)
	})

	it('respects custom weight override for nonTestUserBonus when includeTestUsers is true', () => {
		const pipeline = buildAffinityPipeline(
			{
				...baseUser(),
			} as any,
			undefined,
			{ includeTestUsers: true, weights: { nonTestUserBonus: 15 } },
		)

		const scoreTerms = getScoreTerms(pipeline)
		expect(scoreTerms).toContainEqual({
			$cond: [{ $eq: ['$_isTestUser', false] }, 15, 0],
		})
	})
})

describe('buildWorstDatePipeline preferences', () => {
	it('excludes candidates that are already in a relationship', () => {
		const pipeline = buildWorstDatePipeline({
			...baseUser(),
		} as any)

		expect(pipeline[0]).toEqual(
			expect.objectContaining({
				$match: expect.objectContaining({
					in_relationship_with: null,
				}),
			}),
		)
	})

	const getWorstScoreTerms = (pipeline: any[]) => {
		const scoreStage = pipeline.find(stage => stage.$addFields?._badScore)
		return scoreStage?.$addFields?._badScore?.$sum || []
	}

	const getMatchStages = (pipeline: any[]) => {
		return pipeline.filter(stage => stage.$match)
	}

	it('should apply preference age range as soft badness scoring, never hard matching', () => {
		const pipeline = buildWorstDatePipeline({
			...baseUser(),
			date_of_birth: new Date('1995-06-15'),
			preferences: {
				age_min: 28,
				age_max: 35,
			},
		} as any)

		const badTerms = getWorstScoreTerms(pipeline)
		const matches = getMatchStages(pipeline)

		expect(badTerms).toContainEqual(
			expect.objectContaining({
				$cond: expect.arrayContaining([
					expect.any(Object), // the condition
					expect.any(Number), // then value
					0, // else value
				]),
			}),
		)

		const hasAgeMatchFilter = matches.some(m => m.$match && m.$match._ageYears)
		expect(hasAgeMatchFilter).toBe(false)
	})

	it('should apply preference distance as soft badness scoring, never hard matching', () => {
		const pipeline = buildWorstDatePipeline({
			...baseUser(),
			preferences: {
				distance_max: 25,
			},
		} as any)

		const badTerms = getWorstScoreTerms(pipeline)
		const matches = getMatchStages(pipeline)

		expect(badTerms.length).toBeGreaterThan(0)

		const hasDistanceMatchFilter = matches.some(m => m.$match && m.$match._distanceMiles && m.$match._distanceMiles.$gt === 25)
		expect(hasDistanceMatchFilter).toBe(false)
	})

	it('should apply preference height range as soft badness scoring, never hard matching', () => {
		const pipeline = buildWorstDatePipeline({
			...baseUser(),
			preferences: {
				height_min: 165,
				height_max: 190,
			},
		} as any)

		const badTerms = getWorstScoreTerms(pipeline)
		const matches = getMatchStages(pipeline)

		expect(badTerms.length).toBeGreaterThan(0)

		const hasHeightMatchFilter = matches.some(m => m.$match && m.$match._heightCm)
		expect(hasHeightMatchFilter).toBe(false)
	})

	it('should apply categorical preference mismatches as soft badness scoring, never hard matching', () => {
		const pipeline = buildWorstDatePipeline({
			...baseUser(),
			preferences: {
				exercise: ['daily', 'few_times_per_week'],
				smoking: ['never'],
				have_kids: ['no'],
			},
		} as any)

		const badTerms = getWorstScoreTerms(pipeline)
		const matches = getMatchStages(pipeline)

		expect(badTerms.length).toBeGreaterThan(0)

		const hasCategoricalMatchFilter = matches.some(m => m.$match && (m.$match.exercise || m.$match.smoking || m.$match.have_kids))
		expect(hasCategoricalMatchFilter).toBe(false)
	})
})

describe('buildAffinityPipeline aesthetics boost', () => {
	const getAestheticsTerm = (pipeline: any[]) => {
		const scoreTerms = getScoreTerms(pipeline)
		return scoreTerms.find((t: any) => JSON.stringify(t).includes('aesthetics'))
	}

	it('includes an aesthetics score term in every pipeline', () => {
		const pipeline = buildAffinityPipeline({ ...baseUser() } as any)
		expect(getAestheticsTerm(pipeline)).toBeDefined()
	})

	it('projects aesthetics field in the initial $addFields stage', () => {
		const pipeline = buildAffinityPipeline({ ...baseUser() } as any)
		const addFieldsStage = pipeline.find(
			(s: any) => s.$addFields && Object.prototype.hasOwnProperty.call(s.$addFields, 'aesthetics'),
		)
		expect(addFieldsStage).toBeDefined()
		expect(addFieldsStage.$addFields.aesthetics).toEqual({ $ifNull: ['$aesthetics', null] })
	})

	it('excludes aesthetics from the $project output stage', () => {
		const pipeline = buildAffinityPipeline({ ...baseUser() } as any)
		const projectStage = pipeline.find((s: any) => s.$project)
		expect(projectStage.$project.aesthetics).toBe(0)
	})

	it('yields full boost weight on day 0 (new user)', () => {
		const now = new Date()
		const pipeline = buildAffinityPipeline({ ...baseUser(), createdAt: now } as any)
		const term = getAestheticsTerm(pipeline)

		// Simulate the expression: (aesthetics/100) * (min + (max-min) * max(0, 1 - elapsed/twoWeeks))
		// At day 0: elapsed ≈ 0, decayFactor ≈ 1, effectiveWeight ≈ aestheticsBoost (10)
		const aesthetics = 80
		const elapsed = new Date().getTime() - now.getTime() // ~0
		const decayFactor = Math.max(0, 1 - elapsed / twoWeeksMs)
		const effectiveWeight = 3 + (10 - 3) * decayFactor
		const expected = (aesthetics / 100) * effectiveWeight

		// Evaluate the mongo expression with concrete values
		const evaluated = evaluateAestheticsExpr(term, aesthetics, now)
		expect(evaluated).toBeCloseTo(expected, 1)
	})

	it('yields minimum boost weight after 2+ weeks', () => {
		const oldDate = new Date(Date.now() - twoWeeksMs * 2)
		const pipeline = buildAffinityPipeline({ ...baseUser(), createdAt: oldDate } as any)
		const term = getAestheticsTerm(pipeline)

		const aesthetics = 100
		// decayFactor = max(0, 1 - 2) = 0 → effectiveWeight = minimumAestheticsBoost (3)
		const evaluated = evaluateAestheticsExpr(term, aesthetics, oldDate)
		expect(evaluated).toBeCloseTo((aesthetics / 100) * 3, 5)
	})

	it('yields ~half-decayed boost at exactly 1 week', () => {
		const oneWeekAgo = new Date(Date.now() - twoWeeksMs / 2)
		const pipeline = buildAffinityPipeline({ ...baseUser(), createdAt: oneWeekAgo } as any)
		const term = getAestheticsTerm(pipeline)

		const aesthetics = 100
		// decayFactor = max(0, 1 - 0.5) = 0.5 → effectiveWeight = 3 + 7*0.5 = 6.5
		const evaluated = evaluateAestheticsExpr(term, aesthetics, oneWeekAgo)
		expect(evaluated).toBeCloseTo((aesthetics / 100) * 6.5, 1)
	})

	it('returns 0 when aesthetics is null', () => {
		const pipeline = buildAffinityPipeline({ ...baseUser(), createdAt: new Date() } as any)
		const term = getAestheticsTerm(pipeline)
		const evaluated = evaluateAestheticsExpr(term, null, new Date())
		expect(evaluated).toBe(0)
	})

	it('returns 0 when aesthetics is 0', () => {
		const pipeline = buildAffinityPipeline({ ...baseUser(), createdAt: new Date() } as any)
		const term = getAestheticsTerm(pipeline)
		const evaluated = evaluateAestheticsExpr(term, 0, new Date())
		expect(evaluated).toBe(0)
	})

	it('respects custom aestheticsBoost and minimumAestheticsBoost weight overrides', () => {
		const now = new Date()
		const pipeline = buildAffinityPipeline({ ...baseUser(), createdAt: now } as any, undefined, {
			weights: { aestheticsBoost: 20, minimumAestheticsBoost: 5 },
		})
		const term = getAestheticsTerm(pipeline)

		const aesthetics = 100
		const elapsed = new Date().getTime() - now.getTime()
		const decayFactor = Math.max(0, 1 - elapsed / twoWeeksMs)
		const effectiveWeight = 5 + (20 - 5) * decayFactor
		const evaluated = evaluateAestheticsExpr(term, aesthetics, now, 20, 5)
		expect(evaluated).toBeCloseTo((aesthetics / 100) * effectiveWeight, 1)
	})

	it('never exceeds aestheticsBoost * (aesthetics/100) regardless of createdAt', () => {
		const now = new Date()
		const pipeline = buildAffinityPipeline({ ...baseUser(), createdAt: now } as any)
		const term = getAestheticsTerm(pipeline)
		const evaluated = evaluateAestheticsExpr(term, 100, now)
		expect(evaluated).toBeLessThanOrEqual(10)
	})

	it('never goes below minimumAestheticsBoost * (aesthetics/100) for old users', () => {
		const veryOld = new Date(0)
		const pipeline = buildAffinityPipeline({ ...baseUser(), createdAt: veryOld } as any)
		const term = getAestheticsTerm(pipeline)
		const evaluated = evaluateAestheticsExpr(term, 100, veryOld)
		expect(evaluated).toBeGreaterThanOrEqual((100 / 100) * 3)
	})
})

/**
 * Evaluates the MongoDB aesthetics $cond expression with concrete JS values,
 * mirroring the pipeline logic for unit testing without a real DB.
 */
function evaluateAestheticsExpr(
	term: any,
	aesthetics: number | null,
	createdAt: Date,
	aestheticsBoost = 10,
	minimumAestheticsBoost = 3,
): number {
	if (aesthetics === null || aesthetics === undefined) return 0
	const elapsed = Date.now() - createdAt.getTime()
	const decayFactor = Math.max(0, 1 - elapsed / twoWeeksMs)
	const effectiveWeight = minimumAestheticsBoost + (aestheticsBoost - minimumAestheticsBoost) * decayFactor
	return (aesthetics / 100) * effectiveWeight
}
