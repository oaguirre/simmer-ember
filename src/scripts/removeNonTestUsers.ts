/* eslint-disable import/first */
import dotenv from 'dotenv'

dotenv.config({ path: ['.env', `.${process.env.NODE_ENV || 'development'}.env`] })

import axios from 'axios'
import jwt from 'jsonwebtoken'

import connect from '../utils/db'
import { config } from '../constants'
import { User } from '../resources/user/model'
import { ObjectId } from 'mongodb'

const excludeFromDeletionUserIds = new Set<ObjectId>([
	new ObjectId('6a19fed97cde0f9d7758ab34'), // Admin user - Omar
	new ObjectId('693bb06c0bb872f3e7ede926'), // Test user - Lili
	new ObjectId('6a28bb4fe11dd336523b2ad1'), // Test user - Roman
])

type Mode = 'dry' | 'apply'

type CliOptions = {
	mode: Mode
	limit?: number
	apiBase: string
	timeoutMs: number
}

type CandidateUser = {
	_id: unknown
	first_name?: string
	last_name?: string
	is_test_user?: boolean | null
}

const normalizeBaseUrl = (value: string): string => value.replace(/\/$/, '')

const parseNumberArg = (name: string): number | undefined => {
	const arg = process.argv.find(entry => entry.startsWith(`--${name}=`))
	if (!arg) return undefined
	const value = Number(arg.split('=')[1])
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`Invalid --${name} value: ${arg.split('=')[1]}`)
	}
	return Math.floor(value)
}

const parseStringArg = (name: string): string | undefined => {
	const arg = process.argv.find(entry => entry.startsWith(`--${name}=`))
	if (!arg) return undefined
	const value = arg.split('=')[1]?.trim()
	return value || undefined
}

const parseOptions = (): CliOptions => {
	const hasDry = process.argv.includes('--dry')
	const hasApply = process.argv.includes('--apply')

	if (hasDry === hasApply) {
		throw new Error('Exactly one mode is required: --dry or --apply')
	}

	const mode: Mode = hasApply ? 'apply' : 'dry'
	const limit = parseNumberArg('limit')
	const timeoutMs = parseNumberArg('timeout-ms') || 30000
	const configuredBase = config.baseUrl?.trim()
	const apiBase = normalizeBaseUrl(parseStringArg('api-base') || configuredBase || `http://127.0.0.1:${String(config.port || 4000)}`)

	return {
		mode,
		limit,
		apiBase,
		timeoutMs,
	}
}

const buildAuthToken = (userId: string): string => {
	if (!config.secrets.jwt) {
		throw new Error('Missing JWT secret. Set JWT_SECRET in environment before running this script.')
	}
	return jwt.sign({ id: userId }, config.secrets.jwt, { expiresIn: '15m' })
}

const fetchCandidates = async (limit?: number): Promise<CandidateUser[]> => {
	const query = {
		$or: [{ is_test_user: false }, { is_test_user: { $exists: false } }, { is_test_user: null }],
		$and: [{ _id: { $nin: Array.from(excludeFromDeletionUserIds) } }],
	}

	const baseQuery = User.find(query).select('_id first_name last_name is_test_user').sort({ _id: 1 }).lean()

	if (limit) {
		baseQuery.limit(limit)
	}

	return (await baseQuery.exec()) as CandidateUser[]
}

const deleteUserThroughApi = async (apiBase: string, userId: string, timeoutMs: number): Promise<{ status: number; body: unknown }> => {
	const token = buildAuthToken(userId)
	const response = await axios.delete(`${apiBase}/api/user`, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
		timeout: timeoutMs,
		validateStatus: () => true,
	})

	return {
		status: response.status,
		body: response.data,
	}
}

const run = async (): Promise<void> => {
	const options = parseOptions()
	await connect()

	console.log('[removeNonTestUsers] mode=', options.mode)
	console.log('[removeNonTestUsers] apiBase=', options.apiBase)
	if (options.limit) {
		console.log('[removeNonTestUsers] limit=', options.limit)
	}

	const users = await fetchCandidates(options.limit)
	console.log('[removeNonTestUsers] users matched=', users.length)

	if (users.length === 0) {
		console.log('[removeNonTestUsers] No users matched the filter.')
		return
	}

	let deleted = 0
	let failed = 0

	for (let index = 0; index < users.length; index += 1) {
		const user = users[index]
		const userId = String(user._id)
		const firstName = user.first_name || ''
		const lastName = user.last_name || ''
		console.log(`[${index + 1}/${users.length}] user._id=${userId} first_name=${firstName} last_name=${lastName}`)

		if (options.mode === 'dry') {
			continue
		}

		try {
			const result = await deleteUserThroughApi(options.apiBase, userId, options.timeoutMs)
			if (result.status >= 200 && result.status < 300) {
				deleted += 1
				console.log(`  -> deleted (status=${result.status})`)
			} else {
				failed += 1
				console.error(`  -> failed (status=${result.status}) response=${JSON.stringify(result.body)}`)
			}
		} catch (error) {
			failed += 1
			console.error(`  -> failed (request error) user._id=${userId}`, error)
		}
	}

	console.log('[removeNonTestUsers] summary')
	console.log('  scanned=', users.length)
	if (options.mode === 'apply') {
		console.log('  deleted=', deleted)
		console.log('  failed=', failed)
	} else {
		console.log('  dry-run only; no deletion performed')
	}
}

run()
	.then(() => {
		process.exit(0)
	})
	.catch(error => {
		console.error('[removeNonTestUsers] Failed:', error)
		process.exit(1)
	})
