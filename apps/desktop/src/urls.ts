/**
 * Parsing for the `dsh web` ready line the desktop shell waits on.
 *
 * The web bundle prints `dsh web: http://127.0.0.1:<port>` to stdout once its
 * Loader tree settles ([`dsh-web-app`](../../packages/bundle/web-app/README.md));
 * that line is the sidecar's readiness handshake.
 * @module @deepseek-ai/dsh-desktop/urls
 */

/** The ready line: `dsh web: ` followed by the local origin. */
const WEB_URL_LINE = /^dsh web: (http:\/\/\S+)/

/** Loopback hostnames the window may load; anything else is refused. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Extract the loopback origin from one stdout line of `dsh web`, or `undefined`
 * when the line is not the ready line or does not name a loopback origin.
 *
 * @param line - one stdout line, without its newline.
 * @returns the parsed origin (`http://127.0.0.1:<port>`), or `undefined`.
 */
export function parseWebUrlLine(line: string): string | undefined {
  const match = WEB_URL_LINE.exec(line)
  if (match === null) return undefined
  try {
    const url = new URL(match[1] ?? '')
    return LOOPBACK_HOSTS.has(url.hostname) ? url.origin : undefined
  } catch {
    // The regex admits strings `new URL` rejects (a missing port suffix, for
    // example); a malformed origin is not loadable either way.
    return undefined
  }
}
