import { apiRequest } from './http.js'

export const profileApi = {
  getUserProfile: (token, { signal, routeScoped = true } = {}) => apiRequest('/getUserProfile', { token, signal, routeScoped }),
  getEthnicities: (token, { signal } = {}) => apiRequest('/getEthnicities', { token, signal }),
  updateUserProfile: (body, token, { signal } = {}) => apiRequest('/updateUserProfile', {
    method: 'PATCH', body, token, signal,
  }),
}
