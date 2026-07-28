import { GoogleGenAI } from '@google/genai'

export const client = new GoogleGenAI({
	apiKey: process.env.GOOGLE_GENAI_API_KEY,
})

export default client
