// Navbar clicks select pages; repeating the selected item is a no-op.
export function navigateTo(router, auth, target) {
  const destination = router.resolve(target)
  const selected = router.resolve(auth.pendingRoute || router.currentRoute.value.fullPath)
  if (destination.path === selected.path) return
  return router.push({
    path: destination.path, query: destination.query, hash: destination.hash,
    force: destination.fullPath === router.currentRoute.value.fullPath,
  })
}
