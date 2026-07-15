const jsonHeaders = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
}

export function handleRequest(request: Request): Response {
  const url = new URL(request.url)

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return Response.json(
      {
        ok: true,
        service: 'converge-miniapp',
      },
      { headers: jsonHeaders },
    )
  }

  if (url.pathname.startsWith('/api/')) {
    return Response.json(
      {
        error: 'not_found',
      },
      { status: 404, headers: jsonHeaders },
    )
  }

  return new Response(null, { status: 404 })
}

export default {
  fetch(request) {
    return handleRequest(request)
  },
} satisfies ExportedHandler<Env>
