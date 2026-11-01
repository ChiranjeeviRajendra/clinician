import { apiRequest } from './http.js'

export const appApi = {
  info: (token) => apiRequest('/appInfo', { token }),
}
