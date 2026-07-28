import process from 'node:process'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const SERVER_NAME = 'ember-coach-mcp'
const SERVER_VERSION = '1.0.0'

const methodSet = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const DEFAULT_ALLOWED_PREFIXES = ['/api/user', '/api/relationship', '/api/dating-meet', '/api/moment', '/api/moments', '/api/learning']

function safeJsonParse(input) {
  if (typeof input !== 'string' || input.trim() === '') return null
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}

function parseOptionalObject(input) {
  if (input == null) return undefined
  if (typeof input === 'object' && !Array.isArray(input)) return input
  if (typeof input === 'string') {
    const parsed = safeJsonParse(input)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  }
  throw new Error('Expected an object or JSON object string')
}

function buildQueryString(query) {
  if (!query || typeof query !== 'object') return ''

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) params.append(key, String(item))
      }
      continue
    }
    params.set(key, String(value))
  }

  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

function splitPathAndQuery(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const parsed = new URL(normalized, 'http://localhost')
  const queryObject = {}

  for (const [key, value] of parsed.searchParams.entries()) {
    if (queryObject[key] === undefined) {
      queryObject[key] = value
      continue
    }

    if (Array.isArray(queryObject[key])) {
      queryObject[key].push(value)
      continue
    }

    queryObject[key] = [queryObject[key], value]
  }

  return {
    pathname: parsed.pathname,
    queryFromPath: queryObject,
  }
}

function mergeQueryObjects(baseQuery, overrideQuery) {
  const merged = { ...(baseQuery || {}) }
  for (const [key, value] of Object.entries(overrideQuery || {})) {
    merged[key] = value
  }
  return merged
}

function getAllowedPrefixes() {
  const configured = process.env.SIMMER_ALLOWED_API_PREFIXES
  if (!configured || !configured.trim()) return DEFAULT_ALLOWED_PREFIXES

  return configured
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => (item.startsWith('/') ? item : `/${item}`))
}

function matchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function assertPathAllowed(pathname) {
  const allowedPrefixes = getAllowedPrefixes()
  const isAllowed = allowedPrefixes.some(prefix => matchesPrefix(pathname, prefix))
  if (!isAllowed) {
    throw new Error(`Path is not allowed by SIMMER_ALLOWED_API_PREFIXES: ${pathname}`)
  }
}

function asJsonText(value) {
  return JSON.stringify(value, null, 2)
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) {
    throw new Error('Missing base URL. Set SIMMER_API_BASE_URL (example: https://api.simmerdate.com)')
  }

  const trimmed = String(baseUrl).trim()
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

function resolveBearerToken(inputToken) {
  const token = inputToken || process.env.SIMMER_BEARER_TOKEN
  if (!token) {
    throw new Error('Missing token. Set SIMMER_BEARER_TOKEN or pass token in tool input.')
  }
  return String(token).trim()
}

async function apiRequest({ method, path, query, body, token }) {
  const baseUrl = normalizeBaseUrl(process.env.SIMMER_API_BASE_URL)
  const bearer = resolveBearerToken(token)
  const upperMethod = String(method || '').toUpperCase()

  if (!methodSet.has(upperMethod)) {
    throw new Error(`Unsupported method: ${upperMethod}`)
  }

  if (!path || typeof path !== 'string') {
    throw new Error('Missing path')
  }

  const { pathname, queryFromPath } = splitPathAndQuery(path)
  const mergedQuery = mergeQueryObjects(queryFromPath, query)
  const url = `${baseUrl}${pathname}${buildQueryString(mergedQuery)}`

  const headers = {
    Authorization: `Bearer ${bearer}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }

  const requestInit = {
    method: upperMethod,
    headers,
  }

  if (upperMethod !== 'GET' && upperMethod !== 'DELETE' && body !== undefined) {
    requestInit.body = JSON.stringify(body)
  }

  const response = await fetch(url, requestInit)
  const contentType = response.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')
  const payload = isJson ? await response.json() : await response.text()

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url,
    data: payload,
  }
}

async function handleExploreMatches(args = {}) {
  const query = {
    offset: args.offset,
    limit: args.limit,
    test_users_only: args.test_users_only,
    include_test_users: args.include_test_users,
    use_preference_scoring: args.use_preference_scoring,
    worst: args.include_worst,
  }

  return apiRequest({
    method: 'GET',
    path: '/api/user/explore-dates',
    query,
    token: args.token,
  })
}

async function handleCreateVirtualDate(args = {}) {
  if (!args.user_target) {
    throw new Error('user_target is required')
  }

  const query = {
    user_target: args.user_target,
    skip_date_image: args.skip_date_image,
    matchingPromptVersion: args.matchingPromptVersion,
    summaryPromptVersion: args.summaryPromptVersion,
  }

  const body = parseOptionalObject(args.context)

  return apiRequest({
    method: 'POST',
    path: '/api/user/meet',
    query,
    body,
    token: args.token,
  })
}

async function handleUpdateProfile(args = {}) {
  const profilePatch = parseOptionalObject(args.profile)
  if (!profilePatch || Object.keys(profilePatch).length === 0) {
    throw new Error('profile is required and must contain at least one field')
  }

  return apiRequest({
    method: 'PATCH',
    path: '/api/user',
    body: profilePatch,
    token: args.token,
  })
}

async function handleRelationshipContext(args = {}) {
  if (!args.user_target) {
    throw new Error('user_target is required')
  }

  const [profile, relationship, recentMoments] = await Promise.all([
    apiRequest({ method: 'GET', path: `/api/user/${args.user_target}`, token: args.token }),
    apiRequest({ method: 'GET', path: '/api/relationship', query: { user_target: args.user_target, limit: 20, skip: 0 }, token: args.token }),
    apiRequest({ method: 'GET', path: '/api/dating-meet', query: { user_target: args.user_target, limit: args.limit_moments || 5, skip: 0 }, token: args.token }),
  ])

  return {
    ok: profile.ok && relationship.ok && recentMoments.ok,
    status: profile.ok && relationship.ok && recentMoments.ok ? 200 : 207,
    statusText: 'Multi-source relationship context',
    url: 'composed://relationship-context',
    data: {
      user_target: args.user_target,
      prompt: args.question || null,
      profile,
      relationship,
      recent_moments: recentMoments,
    },
  }
}

async function handleCallApi(args = {}) {
  const { pathname } = splitPathAndQuery(args.path)
  assertPathAllowed(pathname)

  const query = parseOptionalObject(args.query)
  const body = parseOptionalObject(args.body)

  return apiRequest({
    method: args.method,
    path: args.path,
    query,
    body,
    token: args.token,
  })
}

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'explore_matches',
      description: 'Get candidate matches for the authenticated user from /api/user/explore-dates.',
      inputSchema: {
        type: 'object',
        properties: {
          offset: { type: 'integer', minimum: 0, default: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          test_users_only: { type: 'boolean', default: true },
          include_test_users: { type: 'boolean', default: false },
          use_preference_scoring: { type: 'boolean', default: true },
          include_worst: { type: 'boolean', default: false },
          token: {
            type: 'string',
            description: 'Optional bearer token override. If omitted, SIMMER_BEARER_TOKEN is used.',
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'create_virtual_date',
      description: 'Simulate a virtual date by calling /api/user/meet for a target match.',
      inputSchema: {
        type: 'object',
        properties: {
          user_target: { type: 'string', description: 'Target user ID for the date simulation.' },
          skip_date_image: { type: 'boolean', default: true },
          matchingPromptVersion: { type: 'string' },
          summaryPromptVersion: { type: 'string' },
          context: {
            description: 'Optional scenario body as object or JSON string, e.g. LOCATION / SCENARIO_TYPE / QUESTIONS_FOR_DATE.',
            oneOf: [{ type: 'object' }, { type: 'string' }],
          },
          token: {
            type: 'string',
            description: 'Optional bearer token override. If omitted, SIMMER_BEARER_TOKEN is used.',
          },
        },
        required: ['user_target'],
        additionalProperties: false,
      },
    },
    {
      name: 'update_my_profile',
      description: 'Patch profile fields for the authenticated user via /api/user.',
      inputSchema: {
        type: 'object',
        properties: {
          profile: {
            description: 'Profile patch object or JSON object string.',
            oneOf: [{ type: 'object' }, { type: 'string' }],
          },
          token: {
            type: 'string',
            description: 'Optional bearer token override. If omitted, SIMMER_BEARER_TOKEN is used.',
          },
        },
        required: ['profile'],
        additionalProperties: false,
      },
    },
    {
      name: 'relationship_context',
      description: 'Get profile + relationship status + recent dating meets to support coaching about a person.',
      inputSchema: {
        type: 'object',
        properties: {
          user_target: { type: 'string', description: 'User ID to discuss.' },
          question: {
            type: 'string',
            description: 'Optional coaching question to carry alongside the returned context.',
          },
          limit_moments: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
          token: {
            type: 'string',
            description: 'Optional bearer token override. If omitted, SIMMER_BEARER_TOKEN is used.',
          },
        },
        required: ['user_target'],
        additionalProperties: false,
      },
    },
    {
      name: 'call_simmer_api',
      description: 'Generic interface to call approved Simmer API endpoints with bearer authentication.',
      inputSchema: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
          path: { type: 'string', description: 'API path, e.g. /api/dating-meet?limit=5' },
          query: {
            description: 'Optional query object or JSON object string.',
            oneOf: [{ type: 'object' }, { type: 'string' }],
          },
          body: {
            description: 'Optional body object or JSON object string.',
            oneOf: [{ type: 'object' }, { type: 'string' }],
          },
          token: {
            type: 'string',
            description: 'Optional bearer token override. If omitted, SIMMER_BEARER_TOKEN is used.',
          },
        },
        required: ['method', 'path'],
        additionalProperties: false,
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params

  try {
    let result
    if (name === 'explore_matches') result = await handleExploreMatches(args)
    else if (name === 'create_virtual_date') result = await handleCreateVirtualDate(args)
    else if (name === 'update_my_profile') result = await handleUpdateProfile(args)
    else if (name === 'relationship_context') result = await handleRelationshipContext(args)
    else if (name === 'call_simmer_api') result = await handleCallApi(args)
    else throw new Error(`Unknown tool: ${name}`)

    return {
      content: [
        {
          type: 'text',
          text: asJsonText(result),
        },
      ],
      isError: !result.ok,
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: asJsonText({
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        },
      ],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)