import { apiRequest } from './http.js'

export function sendMessage(message, token, { signal } = {}) {
  return apiRequest('/chat', { method: 'POST', body: { message }, token, signal, timeout: 120000 })
}
