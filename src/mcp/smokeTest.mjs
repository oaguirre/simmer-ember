import process from 'node:process'

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) {
    throw new Error('Missing SIMMER_API_BASE_URL')
  }
  const trimmed = String(baseUrl).trim()
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

function getBearerToken() {
  const token = process.env.SIMMER_BEARER_TOKEN
  if (!token) {
    throw new Error('Missing SIMMER_BEARER_TOKEN')
  }
  return String(token).trim()
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.env.SIMMER_API_BASE_URL)
  const token = getBearerToken()

  const endpoint = '/api/user'
  const url = `${baseUrl}${endpoint}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    console.error(JSON.stringify({
      ok: false,
      status: response.status,
      statusText: response.statusText,
      url,
      error: 'Smoke test failed. Check SIMMER_BEARER_TOKEN and API availability.',
      data: body,
    }, null, 2))
    process.exit(1)
  }

  console.log(JSON.stringify({
    ok: true,
    status: response.status,
    statusText: response.statusText,
    url,
    message: 'Bearer auth and API connectivity validated.',
    sampleKeys: body && typeof body === 'object' ? Object.keys(body).slice(0, 10) : null,
  }, null, 2))
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
  process.exit(1)
})
