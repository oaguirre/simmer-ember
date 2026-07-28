/* eslint-disable import/first */
/* eslint-disable no-console */
import dotenv from 'dotenv'
import process from 'node:process'

dotenv.config({ path: ['.env', `.${process.env.NODE_ENV || 'development'}.env`] })

import fs from 'node:fs'
import { Buffer } from 'buffer'
import csv from 'csv-parser'
import mongoose from 'mongoose'
import connect from '../utils/db'
import { User } from '../resources/user/model'

const fsPromises = fs.promises as any

declare const console: Console

type BackupRow = {
	_id?: string
	date_of_birth?: string
}

type Counters = {
	processed: number
	candidates: number
	updated: number
	skippedInvalidId: number
	skippedInvalidDob: number
	skippedMissingUser: number
	skippedMissingField: number
	skippedNonNullDob: number
	skippedRaceCondition: number
}

const args = process.argv.slice(2)
const readBooleanFlag = (argName: string, envName: string): boolean => {
	if (args.includes(argName)) return true
	if (Object.prototype.hasOwnProperty.call(process.env, envName)) {
		const value = process.env[envName]
		if (value === '' || value === undefined) return true
		return value !== 'false' && value !== '0'
	}

	// npm may keep original args in npm_config_argv; use it as a fallback.
	const npmArgv = process.env.npm_config_argv
	if (npmArgv) {
		try {
			const parsed = JSON.parse(npmArgv) as { original?: string[] }
			if (parsed?.original?.includes(argName)) return true
		} catch {
			// Ignore malformed npm_config_argv
		}
	}

	if (argName === '--apply' && args.includes('--appply')) return true
	if (argName === '--apply' && npmArgv?.includes('--appply')) return true

	return false
}

const readOptionValue = (argPrefix: string, envName: string): string => {
	const argValue = args.find(arg => arg.startsWith(argPrefix))
	if (argValue) return argValue.replace(argPrefix, '')
	return process.env[envName] || ''
}

const apply = readBooleanFlag('--apply', 'npm_config_apply') || readBooleanFlag('--write', 'npm_config_write')
const includeMissingField = readBooleanFlag('--include-missing-field', 'npm_config_include_missing_field')

const filePath = readOptionValue('--file=', 'npm_config_file')
const rawLimit = readOptionValue('--limit=', 'npm_config_limit')
const limit = rawLimit ? Number.parseInt(rawLimit, 10) : null

const counters: Counters = {
	processed: 0,
	candidates: 0,
	updated: 0,
	skippedInvalidId: 0,
	skippedInvalidDob: 0,
	skippedMissingUser: 0,
	skippedMissingField: 0,
	skippedNonNullDob: 0,
	skippedRaceCondition: 0,
}

const normalizeObjectId = (value: unknown): string | null => {
	if (typeof value !== 'string') return null
	const trimmed = value.trim().replace(/^\uFEFF/, '')
	const objectIdMatch = trimmed.match(/^ObjectId\((['"]?)([a-fA-F0-9]{24})\1\)$/)
	if (objectIdMatch) {
		return objectIdMatch[2]
	}
	return /^[a-fA-F0-9]{24}$/.test(trimmed) ? trimmed : null
}

const parseDateOfBirth = (value: unknown): Date | null => {
	if (typeof value !== 'string') return null
	const trimmed = value.trim()
	if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
		return null
	}
	const parsed = new Date(trimmed)
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

const detectSeparator = async (pathToFile: string): Promise<',' | '\t'> => {
	const fileHandle = await fsPromises.open(pathToFile, 'r')
	try {
		const buffer = Buffer.alloc(4096)
		const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0)
		const sample = buffer.toString('utf8', 0, bytesRead)
		const firstLine = sample.split(/\r?\n/, 1)[0] || ''
		const tabCount = (firstLine.match(/\t/g) || []).length
		const commaCount = (firstLine.match(/,/g) || []).length
		return tabCount > commaCount ? '\t' : ','
	} finally {
		await fileHandle.close()
	}
}

const readRows = async (pathToFile: string, separator: ',' | '\t'): Promise<BackupRow[]> => {
	return await new Promise((resolve, reject) => {
		const rows: BackupRow[] = []
		fs
			.createReadStream(pathToFile)
			.pipe(
				csv({
					separator,
					mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, ''),
					strict: false,
				}),
			)
			.on('data', (row: BackupRow) => {
				rows.push(row)
			})
			.on('end', () => resolve(rows))
			.on('error', reject)
	})
}

const run = async (): Promise<void> => {
	if (!filePath) {
		throw new Error('Missing --file argument. Example: --file=/absolute/path/to/backup.csv')
	}

	if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
		throw new Error('Invalid --limit value. Use a positive integer.')
	}

	const separator = await detectSeparator(filePath)
	const rows = await readRows(filePath, separator)
	const rowsToProcess = limit ? rows.slice(0, limit) : rows

	console.log('--- DOB backfill summary ---')
	console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
	console.log(`File: ${filePath}`)
	console.log(`Eligibility: ${includeMissingField ? 'null or missing date_of_birth' : 'null date_of_birth only'}`)
	console.log(`Separator: ${separator === '\t' ? 'tab' : 'comma'}`)
	console.log(`Rows loaded: ${rows.length}`)
	console.log(`Rows selected: ${rowsToProcess.length}`)

	await connect()

	for (const row of rowsToProcess) {
		counters.processed += 1
		const normalizedId = normalizeObjectId(row._id)
		if (!normalizedId) {
			counters.skippedInvalidId += 1
			continue
		}

		const parsedDob = parseDateOfBirth(row.date_of_birth)
		if (!parsedDob) {
			counters.skippedInvalidDob += 1
			continue
		}

		const objectId = new mongoose.Types.ObjectId(normalizedId)
		const existingUser = await User.collection.findOne({ _id: objectId }, { projection: { _id: 1, date_of_birth: 1 } })

		if (!existingUser) {
			counters.skippedMissingUser += 1
			continue
		}

		if (!Object.prototype.hasOwnProperty.call(existingUser, 'date_of_birth')) {
			if (!includeMissingField) {
				counters.skippedMissingField += 1
				continue
			}
			counters.candidates += 1
			if (!apply) {
				continue
			}

			const result = await User.updateOne({ _id: objectId, date_of_birth: { $exists: false } }, { $set: { date_of_birth: parsedDob } }, { runValidators: true })

			if (result.modifiedCount > 0) {
				counters.updated += 1
			} else {
				counters.skippedRaceCondition += 1
			}

			if (counters.processed % 100 === 0 || counters.processed === rowsToProcess.length) {
				console.log(`Processed ${counters.processed}/${rowsToProcess.length} rows`)
			}
			continue
		}

		if (existingUser.date_of_birth !== null) {
			counters.skippedNonNullDob += 1
			continue
		}

		counters.candidates += 1

		if (!apply) {
			continue
		}

		const result = await User.updateOne({ _id: objectId, date_of_birth: { $type: 10 } }, { $set: { date_of_birth: parsedDob } }, { runValidators: true })

		if (result.modifiedCount > 0) {
			counters.updated += 1
		} else {
			counters.skippedRaceCondition += 1
		}

		if (counters.processed % 100 === 0 || counters.processed === rowsToProcess.length) {
			console.log(`Processed ${counters.processed}/${rowsToProcess.length} rows`)
		}
	}

	console.log('--- Result ---')
	console.log(`Candidates eligible for update: ${counters.candidates}`)
	console.log(`Updated: ${counters.updated}`)
	console.log(`Skipped invalid _id: ${counters.skippedInvalidId}`)
	console.log(`Skipped invalid date_of_birth: ${counters.skippedInvalidDob}`)
	console.log(`Skipped missing user: ${counters.skippedMissingUser}`)
	console.log(`Skipped missing date_of_birth field: ${counters.skippedMissingField}`)
	console.log(`Skipped non-null date_of_birth: ${counters.skippedNonNullDob}`)
	console.log(`Skipped due to concurrent change: ${counters.skippedRaceCondition}`)

	if (!apply) {
		console.log('Dry-run complete. Re-run with --apply to write updates (or use --write when invoking npm without the -- separator).')
	}
}

run()
	.then(async () => {
		await mongoose.disconnect()
		process.exit(0)
	})
	.catch(async error => {
		console.error('DOB backfill failed:', error)
		await mongoose.disconnect().catch(() => undefined)
		process.exit(1)
	})
