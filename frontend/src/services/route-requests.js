let controller = new AbortController()

export function routeRequestSignal() {
  return controller.signal
}

export function cancelRouteRequests() {
  controller.abort()
  controller = new AbortController()
}
