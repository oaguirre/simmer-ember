/* eslint-disable import/first */
import dotenv from 'dotenv'

dotenv.config({ path: ['.env', `.${process.env.NODE_ENV || 'development'}.env`] })

import mongoose from 'mongoose'
import connect from '../utils/db'
import { Moment } from '../resources/moment/model'
import { Relationship } from '../resources/relationship/model'
import { updateRelationshipBasedOnDate } from '../utils/user/relationship'

type BackfillMoment = {
	user_a: { _id: string }
	user_b: { _id: string }
	when: Date
	title?: string
	summary_a?: string
	summary_b?: string
	flags?: {
		green: string[]
		yellow: string[]
		red: string[]
	}
	tone_score?: string
	match_score?: string
	key_moments?: string[]
	final_why?: { observations: string[]; insight: string }
	tags?: string[]
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const includeAllTypes = args.includes('--all-types')
const fromArg = args.find(arg => arg.startsWith('--from='))
const limitArg = args.find(arg => arg.startsWith('--limit='))

const fromDate = fromArg ? new Date(fromArg.replace('--from=', '')) : null
const limit = limitArg ? Number.parseInt(limitArg.replace('--limit=', ''), 10) : null

const parseId = (value: unknown): string | null => {
	if (!value) return null
	if (typeof value === 'string') return value
	if (value instanceof mongoose.Types.ObjectId) return value.toString()
	if (typeof value === 'object' && '_id' in value) {
		const nested = (value as { _id?: unknown })._id
		return parseId(nested)
	}
	return null
}

const pairKey = (a: string, b: string): string => {
	return [a, b].sort().join('|')
}

const run = async (): Promise<void> => {
	if (fromDate && Number.isNaN(fromDate.getTime())) {
		throw new Error('Invalid --from date. Use ISO format, e.g. --from=2026-01-01')
	}

	await connect()

	const query: Record<string, unknown> = {
		user_b: { $exists: true, $ne: null },
	}

	if (!includeAllTypes) {
		query.type = 'date'
	}

	if (fromDate) {
		query.when = { $gte: fromDate }
	}

	const moments = await Moment.find(query).sort({ when: 1, createdAt: 1 }).lean()
	const grouped = new Map<string, BackfillMoment[]>()

	for (const moment of moments) {
		const userAId = parseId((moment as any).user_a)
		const userBId = parseId((moment as any).user_b)
		if (!userAId || !userBId || userAId === userBId) continue

		const normalizedMoment: BackfillMoment = {
			user_a: { _id: userAId },
			user_b: { _id: userBId },
			when: (moment as any).when || (moment as any).createdAt || new Date(),
			title: (moment as any).title,
			summary_a: (moment as any).summary_a,
			summary_b: (moment as any).summary_b,
			flags: (moment as any).flags,
			tone_score: (moment as any).tone_score,
			match_score: (moment as any).match_score,
			key_moments: (moment as any).key_moments,
			final_why: (moment as any).final_why,
			tags: (moment as any).tags,
		}

		const key = pairKey(userAId, userBId)
		const list = grouped.get(key) || []
		list.push(normalizedMoment)
		grouped.set(key, list)
	}

	const allPairs = Array.from(grouped.entries())
	const pairsToProcess = limit && limit > 0 ? allPairs.slice(0, limit) : allPairs
	const totalMoments = pairsToProcess.reduce((acc, [, pairMoments]) => acc + pairMoments.length, 0)

	console.log('--- Relationship backfill summary ---')
	console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
	console.log(`Types: ${includeAllTypes ? 'all' : 'date only'}`)
	console.log(`From: ${fromDate ? fromDate.toISOString() : 'beginning'}`)
	console.log(`Pairs selected: ${pairsToProcess.length}`)
	console.log(`Moments selected: ${totalMoments}`)

	if (!apply) {
		console.log('Dry-run complete. Re-run with --apply to write updates.')
		return
	}

	let processed = 0
	for (const [key, pairMoments] of pairsToProcess) {
		const [idA, idB] = key.split('|')

		await Relationship.deleteMany({
			type: 'dating',
			$or: [
				{ user_a: idA, user_b: idB },
				{ user_a: idB, user_b: idA },
			],
		})

		for (const moment of pairMoments) {
			await updateRelationshipBasedOnDate(moment as any)
		}

		processed += 1
		if (processed % 100 === 0 || processed === pairsToProcess.length) {
			console.log(`Processed ${processed}/${pairsToProcess.length} pairs`)
		}
	}

	console.log('Relationship backfill completed successfully.')
}

run()
	.then(() => {
		process.exit(0)
	})
	.catch(error => {
		console.error('Relationship backfill failed:', error)
		process.exit(1)
	})
