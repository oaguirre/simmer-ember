import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ifLoginExists, signin, signup } from './auth'
import { User } from '../resources/user/model'

vi.mock('jsonwebtoken', () => ({
	default: {
		sign: vi.fn(() => 'mock-token'),
		verify: vi.fn(),
	},
}))

vi.mock('../resources/user/model', () => ({
	User: {
		findOne: vi.fn(),
		findById: vi.fn(),
		create: vi.fn(),
	},
}))

describe('auth PII regression tests', () => {
	let req: any
	let res: any
	let next: any

	beforeEach(() => {
		vi.clearAllMocks()
		req = { body: {} }
		res = {
			status: vi.fn().mockReturnThis(),
			send: vi.fn().mockReturnThis(),
		}
		next = vi.fn()
	})

	it('signup response does not include password', async () => {
		req.body = {
			username: 'john',
			password: 'secret',
			email: 'john@example.com',
		}

		const populateExistingMock = vi.fn().mockResolvedValue(null)
		const leanExistingMock = vi.fn().mockReturnValue({ populate: populateExistingMock } as any)
		vi.mocked(User.findOne).mockReturnValue({ lean: leanExistingMock } as any)
		vi.mocked(User.create).mockResolvedValue({ _id: 'u1' } as any)
		const leanMock = vi.fn().mockResolvedValue({ _id: 'u1', email: 'john@example.com', password: 'hash' })
		const selectMock = vi.fn().mockReturnValue({ lean: leanMock } as any)
		vi.mocked(User.findById).mockReturnValue({ select: selectMock } as any)

		await signup(req, res, next)

		expect(res.status).toHaveBeenCalledWith(201)
		const payload = vi.mocked(res.send).mock.calls[0][0]
		expect(payload.token).toBe('mock-token')
		expect(payload.data.password).toBeUndefined()
	})

	it('signin response does not include password', async () => {
		req.body = {
			username: 'john',
			password: 'secret',
		}

		const userDoc = {
			_id: 'u1',
			checkPassword: vi.fn().mockResolvedValue(true),
		}
		const execMock = vi.fn().mockResolvedValue(userDoc)
		const selectSigninMock = vi.fn().mockReturnValue({ exec: execMock } as any)
		vi.mocked(User.findOne).mockReturnValue({ select: selectSigninMock } as any)

		const leanMock = vi.fn().mockResolvedValue({ _id: 'u1', email: 'john@example.com', password: 'hash', is_banned: false })
		const selectByIdMock = vi.fn().mockReturnValue({ lean: leanMock } as any)
		vi.mocked(User.findById).mockReturnValue({ select: selectByIdMock } as any)

		await signin(req, res, next)

		expect(res.status).toHaveBeenCalledWith(201)
		const payload = vi.mocked(res.send).mock.calls[0][0]
		expect(payload.token).toBe('mock-token')
		expect(payload.data.password).toBeUndefined()
	})

	it('ifLoginExists returns generic response regardless of account existence', async () => {
		req.body = { login: 'john@example.com', type: 'email' }
		const leanMockA = vi.fn().mockResolvedValue({ _id: 'u1' })
		const selectMockA = vi.fn().mockReturnValue({ lean: leanMockA } as any)
		vi.mocked(User.findOne).mockReturnValueOnce({ select: selectMockA } as any)

		await ifLoginExists(req, res, next)
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.send).toHaveBeenCalledWith({ success: true })

		res.status.mockClear()
		res.send.mockClear()

		const leanMockB = vi.fn().mockResolvedValue(null)
		const selectMockB = vi.fn().mockReturnValue({ lean: leanMockB } as any)
		vi.mocked(User.findOne).mockReturnValueOnce({ select: selectMockB } as any)

		await ifLoginExists(req, res, next)
		expect(res.status).toHaveBeenCalledWith(200)
		expect(res.send).toHaveBeenCalledWith({ success: true })
	})
})
