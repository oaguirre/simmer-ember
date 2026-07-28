/* eslint-disable import/first */
import dotenv from 'dotenv'

dotenv.config({ path: ['.env', `.${process.env.NODE_ENV || 'development'}.env`] })

import connect from '../utils/db'
import { Moment } from '../resources/moment/model'
import { Relationship } from '../resources/relationship/model'

type CliOptions = {
	dryRun: boolean
}

const parseOptions = (): CliOptions => {
	const dryRun = !process.argv.includes('--apply')
	return { dryRun }
}

const migrateMoments = async (dryRun: boolean): Promise<void> => {
	console.log('[migrateFinalWhy:moments] Scanning...')

	const cursor = Moment.find({ final_why: { $type: 'string' } })
		.select('_id final_why')
		.lean()
		.cursor()

	let scanned = 0
	let updated = 0

	for await (const doc of cursor) {
		scanned++
		const oldValue = doc.final_why as unknown as string

		if (dryRun) {
			console.log(`[dry-run] moment ${doc._id} final_why="${oldValue}"`)
		} else {
			await Moment.updateOne({ _id: doc._id }, { $set: { final_why: { observations: [], insight: oldValue } } })
			updated++
		}
	}

	console.log(`[migrateFinalWhy:moments] scanned=${scanned} updated=${dryRun ? '(dry-run)' : updated}`)
}

const migrateRelationships = async (dryRun: boolean): Promise<void> => {
	console.log('[migrateFinalWhy:relationships] Scanning...')

	const cursor = Relationship.find({ 'short_term_memory.final_why': { $type: 'string' } })
		.select('_id short_term_memory')
		.lean()
		.cursor()

	let scanned = 0
	let updated = 0

	for await (const doc of cursor) {
		scanned++

		const updatedMemory = doc.short_term_memory.map(entry => {
			if (typeof (entry.final_why as unknown) === 'string') {
				return {
					...entry,
					final_why: {
						observations: [],
						insight: entry.final_why as unknown as string,
					},
				}
			}
			return entry
		})

		if (dryRun) {
			const affected = doc.short_term_memory.filter(e => typeof (e.final_why as unknown) === 'string').length
			console.log(`[dry-run] relationship ${doc._id} — ${affected} short_term_memory entries to migrate`)
		} else {
			await Relationship.updateOne({ _id: doc._id }, { $set: { short_term_memory: updatedMemory } })
			updated++
		}
	}

	console.log(`[migrateFinalWhy:relationships] scanned=${scanned} updated=${dryRun ? '(dry-run)' : updated}`)
}

const dedup = (arr: string[]): string[] => [...new Set(arr.map(s => s.trim()).filter(Boolean))]

const migrateRelationshipLongTermMemory = async (dryRun: boolean): Promise<void> => {
	console.log('[migrateFinalWhy:long_term_memory] Scanning...')

	const cursor = Relationship.find({ 'long_term_memory.0': { $exists: true } })
		.select('_id user_a user_b long_term_memory')
		.lean()
		.cursor()

	let scanned = 0
	let updated = 0

	for await (const rel of cursor) {
		scanned++

		const userAId = rel.user_a?.toString()
		const userBId = rel.user_b?.toString()

		const updatedLtm = await Promise.all(
			(rel.long_term_memory ?? []).map(async ltmEntry => {
				const yearStart = new Date(ltmEntry.year, 0, 1)
				const yearEnd = new Date(ltmEntry.year + 1, 0, 1)

				const moments = await Moment.find({
					$or: [
						{ user_a: rel.user_a, user_b: rel.user_b },
						{ user_a: rel.user_b, user_b: rel.user_a },
					],
					when: { $gte: yearStart, $lt: yearEnd },
					'final_why.insight': { $exists: true },
				})
					.select('final_why')
					.lean()

				if (moments.length === 0) return ltmEntry

				const allObservations = moments.flatMap(m => m.final_why?.observations ?? [])
				const allInsights = moments.map(m => m.final_why?.insight).filter((s): s is string => !!s)

				const mergedObservations = dedup([...(ltmEntry.final_why?.observations ?? []), ...allObservations])
				const mergedInsights = dedup([...(ltmEntry.final_why?.insights ?? []), ...allInsights])

				return {
					...ltmEntry,
					final_why: {
						observations: mergedObservations,
						insights: mergedInsights,
					},
				}
			}),
		)

		const hasChanges = updatedLtm.some((entry, i) => {
			const orig = rel.long_term_memory?.[i]
			return JSON.stringify(entry.final_why) !== JSON.stringify(orig?.final_why)
		})

		if (!hasChanges) continue

		if (dryRun) {
			updatedLtm.forEach((entry, i) => {
				const orig = rel.long_term_memory?.[i]
				if (JSON.stringify(entry.final_why) !== JSON.stringify(orig?.final_why)) {
					console.log(
						`[dry-run] relationship ${rel._id} year=${entry.year}`,
						`observations=${entry.final_why?.observations.length ?? 0}`,
						`insights=${entry.final_why?.insights.length ?? 0}`,
					)
				}
			})
		} else {
			await Relationship.updateOne({ _id: rel._id }, { $set: { long_term_memory: updatedLtm } })
			updated++
		}
	}

	console.log(`[migrateFinalWhy:long_term_memory] scanned=${scanned} updated=${dryRun ? '(dry-run)' : updated}`)
}

const run = async (): Promise<void> => {
	const { dryRun } = parseOptions()

	console.log('[migrateFinalWhy] Start')
	console.log('[migrateFinalWhy] mode=', dryRun ? 'dry-run (pass --apply to write)' : 'apply')

	await connect()

	await migrateMoments(dryRun)
	await migrateRelationships(dryRun)
	await migrateRelationshipLongTermMemory(dryRun)

	console.log('[migrateFinalWhy] Done')
	process.exit(0)
}

run().catch(err => {
	console.error('[migrateFinalWhy] Fatal error', err)
	process.exit(1)
})
