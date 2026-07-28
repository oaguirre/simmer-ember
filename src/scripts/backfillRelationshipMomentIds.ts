/* eslint-disable import/first */
import dotenv from 'dotenv'

dotenv.config({ path: ['.env', `.${process.env.NODE_ENV || 'development'}.env`] })

import connect from '../utils/db'
import { Relationship } from '../resources/relationship/model'
import { Moment } from '../resources/moment/model'

type CliOptions = {
	dryRun: boolean
	limit?: number
}

const normalizeText = (value?: string | null): string => (value || '').trim().toLowerCase().replace(/\s+/g, ' ')

const normalizeDateMs = (value: unknown): number | null => {
	const ms = new Date(value as any).getTime()
	return Number.isFinite(ms) ? ms : null
}

const getIdString = (value: unknown): string => {
	if (!value) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'object') {
		const objectValue = value as any
		if (typeof objectValue.toHexString === 'function') return objectValue.toHexString()
		if (objectValue._id) return getIdString(objectValue._id)
	}
	return ''
}

const signature = (value: { when?: unknown; title?: string; summary_a?: string; summary_b?: string }): string => {
	return `${normalizeDateMs(value.when) || 'x'}|${normalizeText(value.title)}|${normalizeText(value.summary_a)}|${normalizeText(value.summary_b)}`
}

const parseOptions = (): CliOptions => {
	const dryRun = !process.argv.includes('--write')
	const limitArg = process.argv.find(a => a.startsWith('--limit='))
	const parsedLimit = limitArg ? Number(limitArg.split('=')[1]) : undefined
	const limit = parsedLimit && Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : undefined
	return { dryRun, limit }
}

const backfillRelationshipMomentIds = async (): Promise<void> => {
	const options = parseOptions()
	console.log('[backfillRelationshipMomentIds] Start')
	console.log('[backfillRelationshipMomentIds] mode=', options.dryRun ? 'dry-run' : 'write')
	if (options.limit) {
		console.log('[backfillRelationshipMomentIds] limit=', options.limit)
	}

	const query = {
		short_term_memory: {
			$elemMatch: {
				$or: [{ moment_id: { $exists: false } }, { moment_id: null }],
			},
		},
	}

	const projection = {
		_id: 1,
		user_a: 1,
		user_b: 1,
		short_term_memory: 1,
	}

	const cursor = Relationship.find(query, projection).lean().cursor()

	let scanned = 0
	let changedRelationships = 0
	let updatedRelationships = 0
	let matchedEntries = 0
	let unmatchedEntries = 0

	for await (const relationship of cursor) {
		scanned++
		if (options.limit && scanned > options.limit) break

		const userA = getIdString(relationship.user_a)
		const userB = getIdString(relationship.user_b)
		if (!userA || !userB) continue

		const moments = await Moment.find(
			{
				type: 'date',
				$or: [
					{ user_a: userA, user_b: userB },
					{ user_a: userB, user_b: userA },
				],
			},
			{
				_id: 1,
				when: 1,
				title: 1,
				summary_a: 1,
				summary_b: 1,
			},
		)
			.sort({ when: -1, createdAt: -1 })
			.lean()

		const bySignature = new Map<string, string[]>()
		const byWhen = new Map<number, string[]>()
		for (const m of moments) {
			const momentId = getIdString(m._id)
			if (!momentId) continue
			const sig = signature(m as any)
			const listBySig = bySignature.get(sig) || []
			listBySig.push(momentId)
			bySignature.set(sig, listBySig)

			const whenMs = normalizeDateMs(m.when)
			if (whenMs !== null) {
				const listByWhen = byWhen.get(whenMs) || []
				listByWhen.push(momentId)
				byWhen.set(whenMs, listByWhen)
			}
		}

		let relationshipChanged = false
		const updatedShortTermMemory = (relationship.short_term_memory || []).map((entry: any) => {
			if (getIdString(entry?.moment_id)) {
				return entry
			}

			const sig = signature(entry)
			const candidatesBySig = bySignature.get(sig) || []
			let matchedMomentId = candidatesBySig.length > 0 ? candidatesBySig[0] : ''
			if (!matchedMomentId) {
				const whenMs = normalizeDateMs(entry?.when)
				if (whenMs !== null) {
					const candidatesByWhen = byWhen.get(whenMs) || []
					if (candidatesByWhen.length === 1) {
						matchedMomentId = candidatesByWhen[0]
					}
				}
			}

			if (!matchedMomentId) {
				unmatchedEntries++
				return entry
			}

			matchedEntries++
			relationshipChanged = true
			return {
				...entry,
				moment_id: matchedMomentId,
			}
		})

		if (!relationshipChanged) {
			continue
		}

		changedRelationships++
		if (!options.dryRun) {
			await Relationship.updateOne(
				{ _id: relationship._id },
				{
					$set: {
						short_term_memory: updatedShortTermMemory,
					},
				},
			)
			updatedRelationships++
		}
	}

	console.log('[backfillRelationshipMomentIds] scanned=', scanned)
	console.log('[backfillRelationshipMomentIds] changedRelationships=', changedRelationships)
	console.log('[backfillRelationshipMomentIds] updatedRelationships=', updatedRelationships)
	console.log('[backfillRelationshipMomentIds] matchedEntries=', matchedEntries)
	console.log('[backfillRelationshipMomentIds] unmatchedEntries=', unmatchedEntries)
	console.log('[backfillRelationshipMomentIds] Done')
}

const run = async (): Promise<void> => {
	await connect()
	await backfillRelationshipMomentIds()
}

run()
	.then(() => {
		process.exit(0)
	})
	.catch(error => {
		console.error('[backfillRelationshipMomentIds] Failed:', error)
		process.exit(1)
	})

export default connect
