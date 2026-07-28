import { NextFunction, type Request, type Response } from 'express'
import { termcolors } from '../constants/termcolors'
import ApiError from './apiError'

interface ApiErrorInterface {
  from: string
  code: number
  message: string
  params?: object
}

function apiErrorHandler (err: ApiError, req: Request, res: any, next: any) {
  const from = err.from ? `${termcolors.fgRed}[${err.from}] ${err.code}: ${termcolors.reset}` : ''
  if (err instanceof ApiError) {
    console.error(from + err.message)
    if (err.code === 500) res.status(500).json({ error: 'Something went wrong.' })
    else res.status(err.code).json({ error: err.message, ...err.params })
    return
  }
  if (typeof err === 'string') {
    console.error(from + String(err))
  }
  res.status(500).json({ error: 'Something went horribly wrong.' })
}

export default apiErrorHandler
