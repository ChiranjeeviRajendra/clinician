import { apiRequest } from './http.js'

export const appApi = {
  info: (token, { signal } = {}) => apiRequest('/appInfo', { token, signal, routeScoped: false }),
}
