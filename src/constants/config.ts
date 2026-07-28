export enum Env {
	production = 'production',
	development = 'development',
	test = 'test',
}
export const initConfig = (app: any) => {
	switch (config.env) {
		case Env.production:
			console.log('Production environment')
			break
		case Env.development:
			console.log('Development environment')
			break
		case Env.test:
			console.log('Test environment')
			break
		default:
			throw new Error(`Unknown environment: ${config.env}`)
	}
}

const splitCsv = (value: string | undefined): string[] => {
	if (!value) return []
	return value
		.split(',')
		.map(item => item.trim())
		.filter(Boolean)
}

export const serversAllowed = [
	'https://onboarding.simmerdate.com',
	'https://api.simmerdate.com',
	'http://api.simmerdate.com',
	'https://api.simmerlabs.ai',
	'http://api.simmerlabs.ai',
	'https://9568ffc5-cbe3-476e-984e-572a47f89e2a.sandbox.lovable.dev',
	'https://id-preview--9568ffc5-cbe3-476e-984e-572a47f89e2a.lovable.app',
	'simmerdate-full.lovable.app',
]

const serverHostSuffixesAllowed = ['sandbox.lovable.dev', 'lovable.app', 'lovableproject.com', 'simmerdate.com']

const configuredServerOriginsAllowed = splitCsv(process.env.CORS_ALLOWED_ORIGINS)
const configuredServerHostSuffixesAllowed = splitCsv(process.env.CORS_ALLOWED_HOST_SUFFIXES)

const allowedOrigins = new Set((configuredServerOriginsAllowed.length > 0 ? configuredServerOriginsAllowed : serversAllowed).map(origin => origin.trim().toLowerCase()))
const allowedHostSuffixes = configuredServerHostSuffixesAllowed.length > 0 ? configuredServerHostSuffixesAllowed.map(host => host.toLowerCase()) : serverHostSuffixesAllowed

const hostMatchesSuffix = (hostname: string, suffix: string): boolean => hostname === suffix || hostname.endsWith(`.${suffix}`)

const parseOrigin = (origin: string): URL | null => {
	try {
		return new URL(origin)
	} catch {
		return null
	}
}

export const isServerAllowed = (origin: string): boolean => {
	if (!origin) return true // allow REST tools / non-browser (no origin)
	const trimmedOrigin = origin.trim().toLowerCase()
	const parsedOrigin = parseOrigin(trimmedOrigin)
	if (!parsedOrigin) return false
	if (allowedOrigins.has(parsedOrigin.origin.toLowerCase())) return true

	const hostname = parsedOrigin.hostname.toLowerCase()
	if (hostname === 'localhost') return true
	if (parsedOrigin.protocol !== 'https:') return false

	return allowedHostSuffixes.some(suffix => hostMatchesSuffix(hostname, suffix))
}

export const config = {
	env: process.env.NODE_ENV,
	port: process.env.PORT || 4000,
	baseUrl: process.env.BASE_URL,
	logLevel: process.env.LOG_LEVEL,
	timeout: Number(process.env.API_TIMEOUT || '300000'),
	defaultPassword: process.env.DEFAULT_PASSWORD || '12345',
	summaryAImodelProvider: process.env.SUMMARY_MODEL_PROVIDER || 'openai',
	user: {
		media: {
			mediaUploadLimit: parseInt(process.env.USER_MEDIA_IMAGE_UPLOAD_LIMIT || '9', 10),
		},
	},
	moment: {
		maxImagesPerMeeting: parseInt(process.env.DATING_MEET_MAX_IMAGES_PER_MEETING || '5', 10),
	},
	cors: {
		origin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
			// allow REST tools / non-browser (no origin) and exact matches
			if (!origin || isServerAllowed(origin)) return cb(null, true)
			console.error(`CORS blocked for origin: --->${origin}<---`)
			return cb(new Error(`CORS blocked for origin: ${origin}`))
		},
		preflight: {
			maxAge: 600, // cache preflight for 10 minutes
			allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
			exposedHeaders: ['Content-Length', 'Content-Type', 'X-RateLimit-Remaining'],
			optionsSuccessStatus: 204,
		},
		credentials: true, // required if you send cookies or use Authorization from browsers
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
		exposedHeaders: ['Content-Length', 'Content-Type', 'X-RateLimit-Remaining'],
		maxAge: 600, // cache preflight for 10 minutes
		optionsSuccessStatus: 204,
	},
	s3: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
		region: process.env.AWS_REGION || 'us-east-1',
		bucketName: process.env.AWS_PROFILES_BUCKET_NAME || 'simmer-prod',
	},
	claude: {
		enabled: process.env.ANTHROPIC_ENABLED === 'true' || false,
		apiKey: process.env.ANTHROPIC_API_KEY,
		model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-1-20250805',
		maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4000', 10),
		temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE || '0.7'),
		topP: parseFloat(process.env.ANTHROPIC_TOP_P || '0.9'),
		stopSequences: (process.env.ANTHROPIC_STOP_SEQUENCES || '\n\nHuman:\n\nAssistant:').split(',').map(seq => seq.trim()),
	},
	openAI: {
		apiKey: process.env.OPENAI_API_KEY,
		model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
		maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '4000', 10),
		temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
	},
	mongoDB: {
		host: process.env.MONGODB_HOST,
		port: process.env.MONGODB_PORT,
		dbName: process.env.MONGODB_DB_NAME,
		username: process.env.MONGODB_USERNAME,
		password: process.env.MONGODB_PASSWORD,
	},
	secrets: {
		jwt: process.env.JWT_SECRET,
		jwtExp: 31557600, // 1 year
	},
	saltWorkFactor: 10,
	redisHost: process.env.REDIS_HOST || 'localhost',
	redisPort: process.env.REDIS_PORT || '6379',
	email: {
		host: process.env.EMAIL_HOST || 'smtp.gmail.com',
		port: parseInt(process.env.EMAIL_PORT || '587', 10),
		address: process.env.EMAIL_ADDRESS,
		password: process.env.EMAIL_PASSWORD,
	},
}
