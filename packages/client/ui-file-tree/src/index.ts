/**
 * Workspace file-tree surface, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration. The listing service it drives lives in
 * `@deepseek-ai/dsh-host-file-tree`.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
