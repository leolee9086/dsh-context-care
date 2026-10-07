/** Preserve a Host diagnostic alongside the failed route and HTTP status. */
export async function httpFailure(response, route) {
  const status = `${route}: HTTP ${response.status}`
  if (!response.headers?.get('content-type')?.includes('application/json')) return new Error(status)
  const body = await response.json()
  const detail = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : undefined
  return new Error(detail ? `${status}: ${detail}` : status)
}
