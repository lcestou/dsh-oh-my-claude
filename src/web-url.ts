/**
 * True only for an absolute http: or https: URL. A page someone else hands the plugin (an MCP
 * server's sign-in link, say) goes through this before a browser opens it, so a `javascript:`,
 * `data:` or `file:` link is never followed. Text that does not parse as a URL is false, never a
 * throw. Pure, so the server and the client both import it.
 */
export function isWebUrl(u: string): boolean {
  try {
    const { protocol } = new URL(u);

    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
