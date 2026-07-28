import Anthropic from '@anthropic-ai/sdk'
import { config } from '../constants'

console.log('Using Node.js version:', process.version)
console.log('Anthropic API key configured:', Boolean(process.env.ANTHROPIC_API_KEY))

export const client =
	process.env.NODE_ENV !== 'test'
		? new Anthropic({
				apiKey: config.claude.apiKey,
			})
		: null

// export const claudeAI = config.claude.enabled === true
//   ? client?.messages.create({
//     model: config.claude.model,
//     max_tokens: config.claude.maxTokens,
//     temperature: config.claude.temperature,
//     stop_sequences: ['\n\nHuman:', '\n\nAssistant:'],
//     messages: [
//       {
//         role: 'user',
//         content: 'You are a helpful AI assistant. Please respond to the user\'s queries in a friendly and informative manner.'
//       }
//     ]
//   }).then(response => {
//     console.log('Claude AI initialized successfully:', response)
//     return response
//   }).catch(error => {
//     console.error('Error initializing Claude AI:', error)
//     return null
//   }
//   ).then(response => {
//     if (response) {
//       console.log('Claude AI initialized successfully')
//     } else {
//       console.error('Failed to initialize Claude AI')
//     }
//     return response
//   })
//   : null
