import express from 'express'
import { AddressInfo } from 'net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { router as userRouter } from './user'
import { User } from '../../resources/user/model'
import * as helper from '../user/helper'

describe('PATCH /api/user integration', () => {
	const requesterId = '69f8d15fc353a737a7cbaa5d'
	let app: any

	beforeEach(() => {
		app = express()
		app.use(express.json())
		app.use((req, _res, next) => {
			;(req as any).requester = { _id: requesterId }
			next()
		})
		app.use('/api/user', userRouter)
		app.use((error: any, _req: any, res: any, _next: any) => {
			res.status(error?.status || 500).send({
				error: error?.message || String(error),
			})
		})

		vi.spyOn(helper, 'updateUserCoreQA').mockImplementation(() => {})
		vi.spyOn(helper, 'normalizeHeightToCentimeters').mockImplementation((value: unknown) => (typeof value === 'number' ? value : undefined))
		vi.spyOn(helper, 'validatePreferences').mockReturnValue(undefined)
		vi.spyOn(helper, 'isValidUserIdFormat').mockReturnValue(true)
		vi.spyOn(helper, 'syncInRelationshipWith').mockResolvedValue(undefined)
		vi.spyOn(helper, 'getAgeFromDOB').mockReturnValue(33)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	const sendPatch = async (body: Record<string, unknown>) => {
		const server = await new Promise<import('http').Server>(resolve => {
			const started = app.listen(0, () => resolve(started))
		})
		try {
			const { port } = server.address() as AddressInfo
			const response = await fetch(`http://127.0.0.1:${port}/api/user`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			})
			const raw = await response.text()
			let payload: any
			try {
				payload = raw ? JSON.parse(raw) : {}
			} catch {
				payload = { raw }
			}
			return { status: response.status, payload }
		} finally {
			await new Promise<void>(resolve => server.close(() => resolve()))
		}
	}

	it('sets in_relationship_with through PATCH route and syncs relationship state', async () => {
		const partnerId = '69f8d15fc353a737a7cbaa7f'
		vi.spyOn(User, 'findOne').mockResolvedValue({ _id: requesterId, in_relationship_with: null, core_questions: [], core_answers: [] } as any)
		vi.spyOn(User, 'exists').mockResolvedValue({ _id: partnerId } as any)
		const selectMock = vi.fn().mockResolvedValue({ _id: requesterId, in_relationship_with: partnerId, date_of_birth: new Date('1992-01-01') })
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		const result = await sendPatch({ in_relationship_with: partnerId })

		expect(result.status).toBe(200)
		expect(result.payload.success).toBe(true)
		expect(result.payload.data.in_relationship_with).toBe(partnerId)
		expect(helper.syncInRelationshipWith).toHaveBeenCalledWith(requesterId, null, partnerId)
	})

	it('unsets in_relationship_with through PATCH route and syncs relationship demotion', async () => {
		const previousPartnerId = '69f8d15fc353a737a7cbaa7f'
		vi.spyOn(User, 'findOne').mockResolvedValue({ _id: requesterId, in_relationship_with: previousPartnerId, core_questions: [], core_answers: [] } as any)
		const selectMock = vi.fn().mockResolvedValue({ _id: requesterId, in_relationship_with: null, date_of_birth: new Date('1992-01-01') })
		vi.spyOn(User, 'findOneAndUpdate').mockReturnValue({ select: selectMock } as any)

		const result = await sendPatch({ in_relationship_with: null })

		expect(result.status).toBe(200)
		expect(result.payload.success).toBe(true)
		expect(result.payload.data.in_relationship_with).toBeNull()
		expect(helper.syncInRelationshipWith).toHaveBeenCalledWith(requesterId, previousPartnerId, null)
	})
})
