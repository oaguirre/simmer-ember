/* eslint-disable import/first */
import dotenv from 'dotenv'

dotenv.config({ path: ['.env', `.${process.env.NODE_ENV || 'development'}.env`] })

import connect from '../utils/db'
import { Relationship } from '../resources/relationship/model'
import { deduplicateSemanticTags } from '../utils/formatting'

declare const process: {
	argv: string[]
	env: {
		NODE_ENV?: string
	}
	exit: (code?: number) => never
}

declare const console: {
	log: (...args: unknown[]) => void
	error: (...args: unknown[]) => void
}

type CliOptions = {
	dryRun: boolean
	threshold: number
	maxTags: number
	maxKeyMoments: number
	limit?: number
}

const parseNumberArg = (name: string, fallback: number): number => {
	const arg = process.argv.find((a: string) => a.startsWith(`--${name}=`))
	if (!arg) return fallback
	const value = Number(arg.split('=')[1])
	return Number.isFinite(value) ? value : fallback
}

const parseOptions = (): CliOptions => {
	const dryRun = process.argv.indexOf('--write') < 0
	const threshold = Math.min(Math.max(parseNumberArg('threshold', 0.5), 0), 1)
	const maxTags = Math.max(1, Math.floor(parseNumberArg('max-tags', 100)))
	const maxKeyMoments = Math.max(1, Math.floor(parseNumberArg('max-key-moments', 40)))
	const limitArg = process.argv.find((a: string) => a.startsWith('--limit='))
	const parsedLimit = limitArg ? Number(limitArg.split('=')[1]) : undefined
	const limit = parsedLimit && Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : undefined

	return {
		dryRun,
		threshold,
		maxTags,
		maxKeyMoments,
		limit,
	}
}

const dedupKeyMoments = (keyMoments: string[] | undefined, threshold: number, maxKeyMoments: number): string[] | undefined => {
	if (!Array.isArray(keyMoments) || keyMoments.length === 0) return keyMoments
	return deduplicateSemanticTags(keyMoments, threshold).slice(0, maxKeyMoments)
}

const dedupExistingRelationships = async (): Promise<void> => {
	const options = parseOptions()
	console.log('[dedupExistingRelationships] Start')
	console.log('[dedupExistingRelationships] mode=', options.dryRun ? 'dry-run' : 'write')
	console.log('[dedupExistingRelationships] threshold=', options.threshold)
	console.log('[dedupExistingRelationships] maxTags=', options.maxTags, 'maxKeyMoments=', options.maxKeyMoments)
	if (options.limit) {
		console.log('[dedupExistingRelationships] limit=', options.limit)
	}

	const cursor = Relationship.find(
		{},
		{
			_id: 1,
			tags: 1,
			short_term_memory: 1,
			long_term_memory: 1,
		},
	)
		.lean()
		.cursor() as any

	let scanned = 0
	let changed = 0
	let updated = 0
	let tagsBefore = 0
	let tagsAfter = 0
	let keyMomentsBefore = 0
	let keyMomentsAfter = 0

	let relationship = await cursor.next()
	while (relationship) {
		scanned++
		if (options.limit && scanned > options.limit) break

		const sourceTags = Array.isArray(relationship.tags) ? relationship.tags : []
		tagsBefore += sourceTags.length
		const dedupedTags = deduplicateSemanticTags(sourceTags, options.threshold).slice(0, options.maxTags)
		tagsAfter += dedupedTags.length

		const sourceShortTerm = Array.isArray(relationship.short_term_memory) ? relationship.short_term_memory : []
		const dedupedShortTerm = sourceShortTerm.map((memory: { key_moments?: string[] }) => {
			const original = Array.isArray(memory?.key_moments) ? memory.key_moments : []
			keyMomentsBefore += original.length
			const deduped = dedupKeyMoments(original, options.threshold, options.maxKeyMoments) || []
			keyMomentsAfter += deduped.length
			return {
				...memory,
				key_moments: deduped,
			}
		})

		const sourceLongTerm = Array.isArray(relationship.long_term_memory) ? relationship.long_term_memory : []
		const dedupedLongTerm = sourceLongTerm.map((memory: { key_moments?: string[] }) => {
			const original = Array.isArray(memory?.key_moments) ? memory.key_moments : []
			keyMomentsBefore += original.length
			const deduped = dedupKeyMoments(original, options.threshold, options.maxKeyMoments) || []
			keyMomentsAfter += deduped.length
			return {
				...memory,
				key_moments: deduped,
			}
		})

		const tagsChanged = JSON.stringify(sourceTags) !== JSON.stringify(dedupedTags)
		const shortTermChanged = JSON.stringify(sourceShortTerm) !== JSON.stringify(dedupedShortTerm)
		const longTermChanged = JSON.stringify(sourceLongTerm) !== JSON.stringify(dedupedLongTerm)

		if (!tagsChanged && !shortTermChanged && !longTermChanged) {
			continue
		}

		changed++

		if (!options.dryRun) {
			await Relationship.updateOne(
				{ _id: relationship._id },
				{
					$set: {
						tags: dedupedTags,
						short_term_memory: dedupedShortTerm,
						long_term_memory: dedupedLongTerm,
					},
				},
			)
			updated++
		}

		relationship = await cursor.next()
	}

	console.log('[dedupExistingRelationships] scanned=', scanned)
	console.log('[dedupExistingRelationships] changed=', changed)
	console.log('[dedupExistingRelationships] updated=', updated)
	console.log('[dedupExistingRelationships] tags before=', tagsBefore, 'after=', tagsAfter, 'saved=', tagsBefore - tagsAfter)
	console.log('[dedupExistingRelationships] key moments before=', keyMomentsBefore, 'after=', keyMomentsAfter, 'saved=', keyMomentsBefore - keyMomentsAfter)
	console.log('[dedupExistingRelationships] Done')
}

const run = async (): Promise<void> => {
	await connect()
	await dedupExistingRelationships()
}

run()
	.then(() => {
		process.exit(0)
	})
	.catch(error => {
		console.error('[dedupExistingRelationships] Failed:', error)
		process.exit(1)
	})

export default connect
