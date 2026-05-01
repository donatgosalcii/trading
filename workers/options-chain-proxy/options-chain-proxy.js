const UPSTREAM_OPTIONS_CHAIN_URL = 'https://www.gosalci.com/api/options-chain'
const FALLBACK_ORIGIN = 'https://donatgosalcii.github.io'
const ALLOWED_ORIGINS = new Set([
  FALLBACK_ORIGIN,
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

function getCorsHeaders(request) {
  const requestOrigin = request.headers.get('Origin')
  const allowedOrigin =
    requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)
      ? requestOrigin
      : FALLBACK_ORIGIN

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function jsonResponse(request, body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      })
    }

    if (request.method !== 'GET') {
      return jsonResponse(request, { error: 'Method not allowed' }, 405)
    }

    if (requestUrl.pathname !== '/api/options-chain') {
      return jsonResponse(request, { error: 'Not found' }, 404)
    }

    const upstreamUrl = new URL(UPSTREAM_OPTIONS_CHAIN_URL)
    upstreamUrl.search = requestUrl.search

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        headers: {
          Accept: 'application/json',
        },
      })

      const responseHeaders = new Headers(upstreamResponse.headers)
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => {
        responseHeaders.set(key, value)
      })
      responseHeaders.set('Cache-Control', 'no-store')

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      })
    } catch {
      return jsonResponse(
        request,
        { error: 'Options chain proxy failed to reach the upstream API.' },
        502,
      )
    }
  },
}
