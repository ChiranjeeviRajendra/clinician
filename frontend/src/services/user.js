import { apiRequest } from './http.js'

export const userApi = {
  info: (token, { signal } = {}) => apiRequest('/userInfo', { token, signal, routeScoped: false }),
}
