import { apiRequest } from './http.js'

export const profileApi = {
  getUserProfile: (token, { signal } = {}) => apiRequest('/getUserProfile', { token, signal }),
  getEthnicities: (token, { signal } = {}) => apiRequest('/getEthnicities', { token, signal }),
  updateUserProfile: (body, token, { signal } = {}) => apiRequest('/updateUserProfile', {
    method: 'PATCH', body, token, signal,
  }),
}
