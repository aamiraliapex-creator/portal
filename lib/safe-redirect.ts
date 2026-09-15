/**
 * Post-login redirect hardening.
 *
 * A `?next=` parameter is attacker-controlled. Naive checks such as
 * `raw.startsWith('/') && !raw.startsWith('//')` still accept values like
 * `/\evil.example`, which browsers and URL normalisation treat as a
 * protocol-relative reference to an external origin.
 *
 * We therefore: reject any backslash (raw or percent-encoded), resolve the
 * value against the application origin, require the resolved origin to match
 * exactly, and finally require the pathname to be on an allowlist of real
 * application routes.
 */
export const DEFAULT_POST_LOGIN_PATH = '/dashboard'

/** Top-level application routes a user may legitimately land on after signing in. */
export const POST_LOGIN_PATHS = [
  '/dashboard', '/customers', '/cases', '/payments', '/tasks', '/hearings',
  '/calendar', '/documents', '/agents', '/reports', '/notifications',
  '/holidays', '/users', '/audit', '/settings', '/profile',
] as const

export function safeNextPath(raw: string | null | undefined, origin: string): string {
  if (!raw) return DEFAULT_POST_LOGIN_PATH

  // Backslashes (and their encoded form) are never valid in our paths and are a
  // known way to smuggle an authority section past naive prefix checks.
  if (raw.includes('\\') || /%5c/i.test(raw)) return DEFAULT_POST_LOGIN_PATH

  let url: URL
  try {
    url = new URL(raw, origin)
  } catch {
    return DEFAULT_POST_LOGIN_PATH
  }

  // Absolute URLs, protocol-relative URLs and javascript:/data: URLs all fail
  // this check (javascript: resolves to an opaque "null" origin).
  if (url.origin !== origin) return DEFAULT_POST_LOGIN_PATH
  if (!url.pathname.startsWith('/') || url.pathname.includes('\\')) return DEFAULT_POST_LOGIN_PATH

  const allowed = POST_LOGIN_PATHS.some(
    (p) => url.pathname === p || url.pathname.startsWith(p + '/'),
  )
  if (!allowed) return DEFAULT_POST_LOGIN_PATH

  return url.pathname + url.search
}
