import { apiRequest } from './http.js'

export function sendMessage(message, token) {
  return apiRequest('/chat', { method: 'POST', body: { message }, token, timeout: 120000 })
}
