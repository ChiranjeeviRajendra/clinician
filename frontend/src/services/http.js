import { routeRequestSignal } from './route-requests.js'

const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, status = 0, code = 'network_error') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function apiRequest(path, { method = 'GET', body, token, timeout = 15000, signal, routeScoped = true } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const signals = [signal, routeScoped ? routeRequestSignal() : null].filter(Boolean)
  const abort = () => controller.abort()
  for (const parent of signals) {
    if (parent.aborted) abort()
    else parent.addEventListener('abort', abort, { once: true })
  }
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    controller.signal.throwIfAborted()
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    })
    controller.signal.throwIfAborted()
    if (response.status === 204) return null
    let data
    try {
      data = await response.json()
    } catch {
      throw new ApiError('The service returned an unexpected response. Please try again.', response.status, 'invalid_response')
    }
    controller.signal.throwIfAborted()
    if (!response.ok) {
      throw new ApiError(data.error?.message || 'Something went wrong. Please try again.', response.status, data.error?.code)
    }
    return data
  } catch (error) {
    if (signals.some((parent) => parent.aborted)) {
      throw new ApiError('Request cancelled.', 0, 'request_cancelled')
    }
    if (controller.signal.aborted) {
      throw new ApiError('The request took too long. Please try again.', 0, 'request_timeout')
    }
    if (error instanceof ApiError) throw error
    throw new ApiError('Unable to reach the service. Please try again in a moment.')
  } finally {
    clearTimeout(timer)
    for (const parent of signals) parent.removeEventListener('abort', abort)
  }
}
