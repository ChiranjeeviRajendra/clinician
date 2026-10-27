import { apiRequest } from './http.js'

export const authApi = {
  register: (body) => apiRequest('/auth/register', { method: 'POST', body }),
  login: (body) => apiRequest('/auth/login', { method: 'POST', body }),
  me: (token) => apiRequest('/auth/me', { token }),
  logout: (token) => apiRequest('/auth/logout', { method: 'POST', token }),
  verifyEmail: (token) => apiRequest('/auth/verify-email', { method: 'POST', body: { token } }),
  forgotPassword: (email) => apiRequest('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, password) => apiRequest('/auth/reset-password', { method: 'POST', body: { token, password } }),
}
