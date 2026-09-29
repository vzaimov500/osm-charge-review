/**
 * OAuth 2.0 + PKCE via osm-auth. One authorisation per target:
 * osm-auth keys stored tokens by the authorisation URL, so sandbox and live
 * tokens never mix. No client secret exists anywhere (PKCE).
 */
import * as osmAuthModule from 'osm-auth'
import type { NetworkLogger } from '../audit/networkLog'
import { OsmApiClient, TARGETS, type ApiTarget } from './transport/api'

export const SCOPES = 'read_prefs write_api'

/**
 * The members we use. The package's bundled typings describe a class, but the
 * module exports a factory function (and omit getAccessToken), so type it here.
 */
interface OsmAuthInstance {
  authenticated(): boolean
  authenticate(callback: (err: unknown) => void): void
  logout(): void
  getAccessToken(): string
}
const osmAuth = (
  osmAuthModule as unknown as { osmAuth: (o: Record<string, unknown>) => OsmAuthInstance }
).osmAuth

/**
 * Client ids are public by design (PKCE, no secret): OSM only ever redirects to
 * the addresses registered with the app. Env overrides them; so does the app's
 * settings field (for self-hosted copies at other addresses).
 */
const SANDBOX_CLIENT_ID = '60o3-uVjrN8VDVjfOcDibdO1PY6Sosb5QktqAGKuI3M'
export const BUILT_IN_CLIENT_IDS: Record<ApiTarget, string> = {
  sandbox: (import.meta.env.VITE_OSM_SANDBOX_CLIENT_ID as string | undefined) ?? SANDBOX_CLIENT_ID,
  live: (import.meta.env.VITE_OSM_LIVE_CLIENT_ID as string | undefined) ?? '',
}

/** Must be registered, exactly, as the redirect URI of both applications. */
export function redirectUri(): string {
  return new URL('land.html', location.href).href
}

const instances = new Map<string, OsmAuthInstance>()

export function authFor(target: ApiTarget, clientId: string): OsmAuthInstance {
  const k = `${target}:${clientId}`
  let a = instances.get(k)
  if (!a) {
    a = osmAuth({
      url: TARGETS[target].authUrl,
      apiUrl: TARGETS[target].apiUrl,
      client_id: clientId,
      redirect_uri: redirectUri(),
      scope: SCOPES,
      singlepage: false,
    })
    instances.set(k, a)
  }
  return a
}

/**
 * Start sign-in. Must be called synchronously from a click handler: the
 * popup is opened before anything is awaited, or browsers block it.
 */
export function signIn(
  target: ApiTarget,
  clientId: string,
  done: (err: Error | null) => void,
): void {
  authFor(target, clientId).authenticate((err) =>
    done(err ? (err instanceof Error ? err : new Error(String(err))) : null),
  )
}

export function signOut(target: ApiTarget, clientId: string): void {
  authFor(target, clientId).logout()
}

export function isSignedIn(target: ApiTarget, clientId: string): boolean {
  return clientId !== '' && authFor(target, clientId).authenticated()
}

/** The only way the app obtains an API client: URL and token from the same target. */
export function apiFor(target: ApiTarget, clientId: string, logger: NetworkLogger): OsmApiClient {
  return new OsmApiClient({
    target,
    apiUrl: TARGETS[target].apiUrl,
    token: () => (clientId ? authFor(target, clientId).getAccessToken() || null : null),
    logger,
  })
}
