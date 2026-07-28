import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../resources/matches/prompts', () => ({
	avatarPrompts: { v1_2: 'avatar prompt' },
	momentImagePrompts: { v2_2: { prompt: 'meeting prompt', getMomentInformation: vi.fn() } },
	addAdditionalQAToInput: vi.fn(),
}))

vi.mock('../../utils/openAI', () => ({
	client: {
		images: {
			edit: vi.fn(),
		},
		responses: {
			create: vi.fn(),
		},
	},
}))

vi.mock('../../utils/claudeAI', () => ({
	client: {},
}))

vi.mock('../../utils/aws', () => ({
	uploadBufferToS3: vi.fn(),
	generateS3GetPresignedUrl: vi.fn((key: string) => `https://signed.local/${key}?sig=1`),
	checkS3IfFileExists: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../resources/media/model', () => ({
	default: {
		findOne: vi.fn().mockResolvedValue(null),
	},
	Media: {
		findOne: vi.fn().mockResolvedValue(null),
	},
}))

vi.mock('../../resources/user/model', () => ({
	defaultQuestions: [],
	User: {},
}))

vi.mock('../../resources/moment/model', () => ({
	Moment: {},
}))

vi.mock('../../resources/relationship/model', () => ({
	Relationship: {},
}))

vi.mock('../logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

vi.mock('sharp', () => ({
	default: vi.fn(),
}))

import sharp from 'sharp'
import { client as openAI } from '../../utils/openAI'
import { uploadBufferToS3 } from '../../utils/aws'
import { createAvatarImage, createMomentImageWithOpenAIv2 } from './helper'

const makeWebPBuffer = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)])
const makeJpegBuffer = () => Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00])

describe('AI image generation uploads WebP', () => {
	const originalFetch = global.fetch

	afterEach(() => {
		global.fetch = originalFetch
	})

	beforeEach(() => {
		vi.clearAllMocks()

		const mockSharpChain = {
			withMetadata: vi.fn().mockReturnThis(),
			webp: vi.fn().mockReturnThis(),
			toBuffer: vi.fn().mockResolvedValue(makeWebPBuffer()),
		}
		vi.mocked(sharp).mockReturnValue(mockSharpChain as any)

		vi.mocked(uploadBufferToS3).mockResolvedValue({
			Key: 'mock.webp',
			Location: 'https://s3.local/mock.webp',
		} as any)

		vi.mocked(openAI.images.edit).mockResolvedValue({
			data: [{ b64_json: makeJpegBuffer().toString('base64') }],
			usage: { input_tokens: 1, output_tokens: 1 },
		} as any)

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			blob: async () => new Blob([makeJpegBuffer()], { type: 'image/jpeg' }),
		}) as any
	})

	it('uploads AI avatar image to S3 with image/webp and .webp key', async () => {
		await createAvatarImage({ _id: 'user-a' } as any, makeJpegBuffer())

		expect(uploadBufferToS3).toHaveBeenCalledWith(expect.any(Buffer), 'image/webp', expect.stringMatching(/\.webp$/))
	})

	it('uploads AI dating image to S3 with image/webp and .webp key', async () => {
		const result = await createMomentImageWithOpenAIv2({ _id: 'user-a' } as any, { _id: 'user-b' } as any, new Date('2026-06-17T00:00:00.000Z'), ['great date'])

		expect(uploadBufferToS3).toHaveBeenCalledWith(expect.any(Buffer), 'image/webp', expect.stringMatching(/^meeting_date\/.*\.webp$/))
		expect(result?.dateMeetingPresignedUrl).toContain('.webp')
	})

	it('throws if conversion output is not WebP bytes before upload', async () => {
		const badSharpChain = {
			withMetadata: vi.fn().mockReturnThis(),
			webp: vi.fn().mockReturnThis(),
			toBuffer: vi.fn().mockResolvedValue(makeJpegBuffer()),
		}
		vi.mocked(sharp).mockReturnValueOnce(badSharpChain as any)

		await expect(createAvatarImage({ _id: 'user-a' } as any, makeJpegBuffer())).rejects.toThrow('Expected converted image/webp buffer before upload')
		expect(uploadBufferToS3).not.toHaveBeenCalled()
	})
})
