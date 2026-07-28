/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-invalid-void-type */
import jwt from 'jsonwebtoken'

import { config } from '../constants/config'
import { User, type UserType } from '../resources/user/model'
import { type Req } from '../utils/types'
import { ApiError } from '../utils'
import { generateUsername } from 'unique-username-generator'
import { verifyViewDateToken, type ViewDateTokenPayload } from '../utils/user/moment'
import { MediaType } from '../resources/media/model'
import { logger } from '../utils/logger'
import { toSelfUser } from '../utils/user/serializers'

export const validateEmail = (email: string): boolean => {
	const regex = /\S+@\S+\.\S+/
	return regex.test(email)
}

export const validatePhone = (phone: string): boolean => {
	const regex = /^[+]?\d{6,14}/
	return regex.test(phone)
}

export const newToken = (user: any): string => jwt.sign({ id: user._id }, config.secrets.jwt || '', { expiresIn: config.secrets.jwtExp })

export const verifyToken = async (token: string): Promise<any> =>
	await new Promise((resolve, reject) => {
		jwt.verify(token, config.secrets.jwt || '', (err: any, payload: any) => {
			if (err) {
				reject(err)
				return
			}
			resolve(payload)
		})
	})

export const signup = async (req: Req, res: any, next: any): Promise<any> => {
	try {
		const { username = generateUsername(), password = config.defaultPassword, first_name, last_name, email, phone, is_test_user = false } = req.body
		if (!username) {
			next(ApiError.badRequest('Username must be provided or excluded from input body', 'signup'))
			return
		}
		if (!password) {
			next(ApiError.badRequest('Password must be provided', 'signup'))
			return
		}
		if (email && !validateEmail(email)) {
			next(ApiError.badRequest('Invalid email', 'signup'))
			return
		}
		const existingUser = await User.findOne({ username }).lean().populate<{ profile_image_media_id: MediaType }>('profile_image_media_id')
		if (existingUser) {
			next(ApiError.badRequest('User already exists', 'signup'))
			return
		}

		const user = await User.create({ username, password, first_name, last_name, email, phone, is_test_user })
		const token = newToken(user)
		const userData = await User.findById(user._id).select('-password +email +phone +loc_latitude +loc_longitude +loc_address +loc_postal_code +date_of_birth').lean()
		return res.status(201).send({ token, success: true, data: toSelfUser(userData as any) })
	} catch (error) {
		next(ApiError.internal(String(error), 'signup'))
	}
}

export const signin = async (req: Req, res: any, next: any): Promise<any> => {
	try {
		const { username, password } = req.body
		if (!username || !password) {
			next(ApiError.badRequest('Username & Password must be provided', 'signin'))
			return
		}
		const user: UserType | null = await User.findOne({ username }).select('username password').exec()
		// console.log('user signin', { username, password, user })
		if (!user) {
			next(ApiError.badRequest('Username & Password mismatch', 'signin'))
			return
		}
		const match = await user.checkPassword(password)
		if (!match) {
			next(ApiError.badRequest('Username & Password mismatch', 'signin'))
			return
		}

		const token = newToken(user)

		const userInfo = await User.findById(user._id).select('-password +email +phone +loc_latitude +loc_longitude +loc_address +loc_postal_code +date_of_birth').lean()

		if (userInfo?.is_banned) {
			next(ApiError.badRequest("We can't log you in at the moment.", 'signin'))
			return
		}
		return res.status(201).send({ token, data: toSelfUser(userInfo as any) })
	} catch (error) {
		next(ApiError.internal(String(error), 'signin'))
	}
}

export const protect = async (req: Req, res: any, next: any): Promise<void | any> => {
	const bearer = (req as any).headers.authorization
	if (!bearer || !bearer.startsWith('Bearer ')) {
		const { originalUrl, query } = req as any
		// Check if the request is for viewing a dating meet with a valid signature
		const signature = (query.signature as string) || ''
		if (!signature) {
			return res.status(401).end()
		}
		// Verify the signature and get the user ID and meeting ID
		const viewMoment: ViewDateTokenPayload | null = await verifyViewDateToken(signature).catch(() => null)
		const startsWithMoment = originalUrl.startsWith('/api/dating-meet/') || originalUrl.startsWith('/api/moment/') || originalUrl.startsWith('/api/moments/')
		if (startsWithMoment && viewMoment) {
			const id = originalUrl.startsWith('/api/dating-meet/')
				? originalUrl.split('/api/dating-meet/')[1].split('?')[0]
				: originalUrl.startsWith('/api/moments/')
					? originalUrl.split('/api/moments/')[1].split('?')[0]
					: originalUrl.split('/api/moment/')[1].split('?')[0]
			if (id !== viewMoment?.momentId) {
				return res.status(401).end()
			}
			const sharedUser = await User.findById(viewMoment.userId)
				.select('-password +email +phone +loc_latitude +loc_longitude +loc_address +loc_postal_code +date_of_birth')
				.populate('profile_image_media_id')
				.lean()
				.exec()
			if (!sharedUser) {
				return res.status(401).end()
			} else if (sharedUser.is_banned) {
				next(ApiError.badRequest('Access restricted', 'protect'))
				return
			}
			req.requester = sharedUser
			next()
			return
		}
		return res.status(401).end()
	}
	const token = bearer.split('Bearer ')[1].trim()
	let payload
	try {
		payload = await verifyToken(token)
	} catch (error) {
		logger.error('-', '[protect]', error)
		return res.status(401).end()
	}

	const user = await User.findById(payload.id)
		.select('-password +email +phone +loc_latitude +loc_longitude +loc_address +loc_postal_code +date_of_birth')
		.populate('profile_image_media_id')
		.lean()
		.exec()
	if (!user) {
		return res.status(401).end()
	} else if (user.is_banned) {
		next(ApiError.badRequest('Access restricted', 'protect'))
		return
	}
	req.requester = user
	next()
}

export const ifLoginExists = async (req: Req, res: any, next: any) => {
	try {
		const { login, type } = req.body
		if (!login || !type) {
			next(ApiError.badRequest('Login & type must be provided', 'ifLoginExists'))
			return
		}
		if (typeof login !== 'string' || typeof type !== 'string') {
			next(ApiError.badRequest('Login & type must be a string', 'ifLoginExists'))
			return
		}
		if (type !== 'phone' && type !== 'email') {
			next(ApiError.badRequest('Type must be either phone or email', 'ifLoginExists'))
			return
		}
		if (type === 'phone' && !validatePhone(login)) {
			next(ApiError.badRequest('Incorrect phone number format', 'ifLoginExists'))
			return
		}
		if (type === 'email' && !validateEmail(login)) {
			next(ApiError.badRequest('Incorrect email format', 'ifLoginExists'))
			return
		}

		// Always perform the lookup to prevent timing-based enumeration, but
		// always return the same response shape so the caller cannot infer
		// whether the account exists.
		await User.findOne({ [type === 'phone' ? 'phone' : 'email']: login })
			.select('_id')
			.lean()
		return res.status(200).send({ success: true })
	} catch (error) {
		next(ApiError.internal(String(error), 'ifLoginExists'))
	}
}
