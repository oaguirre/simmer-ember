import { NextFunction } from 'express'
import { ifLoginExists, protect, signin, signup } from '../middleware/auth'
import ApiError from './apiError'
import apiErrorHandler from './apiErrorHandler'
import connect from './db'
import { terminate } from './process'
import { registerRoutes } from './router'
import { type FormDataReq, type Req } from './types'

// eslint-disable-next-line promise/no-callback-in-promise
const use = (fn: any) => async (req: Req, res: Response, next: any) => await Promise.resolve(fn(req, res, next)).catch(next)

export { ApiError, apiErrorHandler, protect, ifLoginExists, signin, signup, terminate, connect, registerRoutes, type Req, type FormDataReq, use }
