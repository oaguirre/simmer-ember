import { type Request } from 'express'
import { type LeanDocument } from 'mongoose'
import { type UserType } from '../resources/user/model'

export interface Req {
  requester: LeanDocument<UserType>
  body: any
  headers: any
  originalUrl?: string
  query?: any
  params?: any
}

export interface FormDataReq {
  requester: LeanDocument<UserType>
  body: {
    data: string
    type: string
  }
  file: any
  query: any
  params: any
}
