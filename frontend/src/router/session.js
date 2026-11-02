// Only return to an existing protected route in this application.
export function getReturnTo(router, ...candidates) {
  for (const path of candidates) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u0020]/.test(path)) continue
    const resolved = router.resolve(path)
    if (resolved.meta.requiresAuth && !resolved.matched.some((record) => record.redirect)) return resolved.fullPath
  }
  return '/home'
}

export function loginLocation(auth, path, reason = auth.loginReason || 'denied') {
  auth.rememberPage(path)
  auth.endSession(reason)
  return { name: 'login', query: { ...(reason ? { reason } : {}), redirect: path } }
}
