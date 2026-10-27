const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, status = 0, code = 'network_error') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function apiRequest(path, { method = 'GET', body, token, timeout = 15000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    })
    if (response.status === 204) return null
    let data
    try {
      data = await response.json()
    } catch {
      throw new ApiError('The service returned an unexpected response. Please try again.', response.status, 'invalid_response')
    }
    if (!response.ok) {
      throw new ApiError(data.error?.message || 'Something went wrong. Please try again.', response.status, data.error?.code)
    }
    return data
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted) {
      throw new ApiError('The request took too long. Please try again.', 0, 'request_timeout')
    }
    throw new ApiError('Unable to reach the service. Please try again in a moment.')
  } finally {
    clearTimeout(timer)
  }
}
