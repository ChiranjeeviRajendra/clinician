// Only return to an existing protected route in this application.
export function getReturnTo(router, ...candidates) {
  for (const path of candidates) {
    // Reject control characters as well as spaces and backslashes in redirect paths.
    if (
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      [...path].some((character) => character <= ' ' || character === '\\')
    )
      continue
    const resolved = router.resolve(path)
    if (resolved.meta.requiresAuth && !resolved.matched.some((record) => record.redirect))
      return resolved.fullPath
  }
  return '/home'
}

export function loginLocation(auth, path, reason = auth.loginReason || 'denied') {
  auth.rememberPage(path)
  auth.endSession(reason)
  return { name: 'login', query: { ...(reason ? { reason } : {}), redirect: path } }
}
