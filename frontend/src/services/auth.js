import { apiRequest } from './http.js'

// Account actions run independently of page navigation.
const accountRequest = (path, options) => apiRequest(path, { ...options, routeScoped: false })

export const authApi = {
  register: (body) => accountRequest('/auth/register', { method: 'POST', body }),
  login: (body) => accountRequest('/auth/login', { method: 'POST', body }),
  me: (token) => accountRequest('/auth/me', { token }),
  logout: (token) => accountRequest('/auth/logout', { method: 'POST', token }),
  verifyEmail: (token) => accountRequest('/auth/verify-email', { method: 'POST', body: { token } }),
  forgotPassword: (email) => accountRequest('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, password) => accountRequest('/auth/reset-password', { method: 'POST', body: { token, password } }),
}
