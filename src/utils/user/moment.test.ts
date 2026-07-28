import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { pipelineMock, summarizerMock, claudeCreateMock } = vi.hoisted(() => ({
	pipelineMock: vi.fn(),
	summarizerMock: vi.fn(),
	claudeCreateMock: vi.fn(),
}))

vi.mock('@xenova/transformers', () => ({
	pipeline: pipelineMock,
	cat: vi.fn(),
}))

vi.mock('../claudeAI', () => ({
	client: {
		messages: {
			create: claudeCreateMock,
		},
	},
}))

describe('validateAndFormatFeedback summarization', () => {
	let validateAndFormatFeedback: (moment: any, feedback: any) => Promise<any>

	beforeAll(async () => {
		const momentUtils = await import('./moment')
		validateAndFormatFeedback = momentUtils.validateAndFormatFeedback
	})

	beforeEach(() => {
		vi.clearAllMocks()
		pipelineMock.mockResolvedValue(summarizerMock)
	})

	it('generates question title and summary using the pipeline', async () => {
		summarizerMock.mockResolvedValueOnce([{ summary_text: 'Auto Question Title' }]).mockResolvedValueOnce([{ summary_text: 'Auto Question Summary' }])

		const result = await validateAndFormatFeedback({ feedback: [] } as any, {
			source: 'user_a',
			question: 'What did you enjoy the most?',
			answer: 'The conversation felt natural.',
		})

		expect(pipelineMock).toHaveBeenCalledTimes(1)
		expect(summarizerMock).toHaveBeenNthCalledWith(1, 'What did you enjoy the most?\nAnswer: The conversation felt natural.', { max_length: 50 })
		expect(summarizerMock).toHaveBeenNthCalledWith(2, 'What did you enjoy the most?\nAnswer: The conversation felt natural.', { max_length: 512 })
		expect(result).toHaveLength(1)
		expect(result[0]).toEqual(
			expect.objectContaining({
				title: 'Auto Question Title',
				summary: 'Auto Question Summary',
				question: 'What did you enjoy the most?',
				answer: 'The conversation felt natural.',
			}),
		)
	})

	it('generates only summary when title is provided for comments', async () => {
		summarizerMock.mockResolvedValueOnce([{ summary_text: 'Auto Comment Summary' }])

		const result = await validateAndFormatFeedback({ feedback: [] } as any, {
			source: 'user_a',
			title: 'Manual Comment Title',
			comment: 'I liked the pacing and clarity throughout the date.',
		})

		expect(summarizerMock).toHaveBeenCalledTimes(1)
		expect(summarizerMock).toHaveBeenCalledWith('I liked the pacing and clarity throughout the date.', { max_length: 512 })
		expect(result[0]).toEqual(
			expect.objectContaining({
				title: 'Manual Comment Title',
				summary: 'Auto Comment Summary',
				comment: 'I liked the pacing and clarity throughout the date.',
			}),
		)
	})

	it('uses fallback title and summary when pipeline generation fails', async () => {
		summarizerMock.mockRejectedValue(new Error('pipeline failed'))

		const result = await validateAndFormatFeedback({ feedback: [] } as any, {
			source: 'user_a',
			question: 'Would you like to meet again?',
			answer: 'Yes',
		})

		expect(result[0]).toEqual(
			expect.objectContaining({
				title: 'Question: "Would you like to meet again?" Answer: "Yes"',
				summary: 'Feedback on question: "Would you like to meet again?" with answer "Yes"',
			}),
		)
	})

	it('updates existing feedback entry by _id', async () => {
		const existingWhen = new Date('2026-01-01T00:00:00.000Z')
		const result = await validateAndFormatFeedback(
			{
				feedback: [
					{
						_id: 'feedback123',
						source: 'user_a',
						target: 'relationship',
						validation_score: 7,
						comment: 'Old feedback comment',
						title: 'Existing title',
						summary: 'Existing summary',
						when: existingWhen,
					},
				],
			} as any,
			{
				_id: 'feedback123',
				source: 'user_a',
				validation_score: 9,
				comment: 'Updated feedback comment',
			},
		)

		expect(result).toHaveLength(1)
		expect(result[0]).toEqual(
			expect.objectContaining({
				_id: 'feedback123',
				validation_score: 9,
				comment: 'Updated feedback comment',
				title: 'Existing title',
				summary: 'Existing summary',
			}),
		)
	})
})

describe('summarizeMoment content assembly', () => {
	let summarizeMoment: (moment: any) => Promise<{ summary: string; title: string }>

	beforeAll(async () => {
		const momentUtils = await import('./moment')
		summarizeMoment = momentUtils.summarizeMoment
	})

	beforeEach(() => {
		vi.clearAllMocks()
		claudeCreateMock.mockResolvedValue({
			content: [{ type: 'text', text: '{"summary":"S","title":"T"}' }],
		})
	})

	it('uses journal as primary content and appends feedback comments', async () => {
		await summarizeMoment({
			type: 'date',
			universe: 'reality',
			journal_a: ['Journal line 1', 'Journal line 2'],
			conversation: 'Conversation should be ignored when journal exists',
			moment: 'Moment fallback should be ignored when journal exists',
			feedback: [{ source: 'user_a', validation_score: 8, comment: 'Great pacing.' }],
		} as any)

		const callArg = claudeCreateMock.mock.calls[0][0]
		const userContent = callArg.messages[1].content as string
		expect(userContent).toContain('Journal line 1\n---\nJournal line 2')
		expect(userContent).not.toContain('Conversation should be ignored when journal exists')
		expect(userContent).not.toContain('Moment fallback should be ignored when journal exists')
		expect(userContent).toContain('Feedback with validation score 8 by user_a: Great pacing.')
	})

	it('uses conversation when journal is not available', async () => {
		await summarizeMoment({
			type: 'call',
			universe: 'reality',
			journal_a: [],
			conversation: 'Conversation content used for summary',
			moment: 'Moment fallback should be ignored when conversation exists',
			feedback: [],
		} as any)

		const callArg = claudeCreateMock.mock.calls[0][0]
		const userContent = callArg.messages[1].content as string
		expect(userContent).toContain('Conversation content used for summary')
		expect(userContent).not.toContain('Moment fallback should be ignored when conversation exists')
	})

	it('falls back to moment field when journal and conversation are missing', async () => {
		await summarizeMoment({
			type: 'text',
			universe: 'reality',
			journal_a: [],
			conversation: '',
			moment: 'Fallback moment description',
			feedback: [
				{ source: 'ai', validation_score: 9, comment: '' },
				{ source: 'manager', validation_score: 7, comment: 'Include this comment.' },
			],
		} as any)

		const callArg = claudeCreateMock.mock.calls[0][0]
		const userContent = callArg.messages[1].content as string
		expect(userContent).toContain('Fallback moment description')
		expect(userContent).toContain('Feedback with validation score 7 by manager: Include this comment.')
		expect(userContent).not.toContain('validation score 9 by ai')
	})
})

describe('trimPathOnly', () => {
	let trimPathOnly: (path: string) => string

	beforeAll(async () => {
		const momentUtils = await import('./moment')
		trimPathOnly = momentUtils.trimPathOnly
	})

	it('extracts a clean key from a full S3 URL', () => {
		const raw = 'https://simmer-prod.s3.amazonaws.com/meeting_date/u1_u2/u1_u2_1781899388497.webp?AWSAccessKeyId=KEY&Expires=1782508406&Signature=abc%2B123'

		expect(trimPathOnly(raw)).toBe('meeting_date/u1_u2/u1_u2_1781899388497.webp')
	})

	it('removes query string from bare key paths', () => {
		expect(trimPathOnly('meeting_date/u1_u2/file.webp?foo=bar')).toBe('meeting_date/u1_u2/file.webp')
	})
})
