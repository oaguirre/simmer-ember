import OpenAI from 'openai'
import { config } from '../constants'

export const client = process.env.NODE_ENV !== 'test' ? new OpenAI({ apiKey: config.openAI.apiKey }) : null
