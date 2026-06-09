/**
 * XML escaping for hand-built SAML protocol messages (Prompt 38 §A4 / §6). Single source of truth — these
 * were duplicated verbatim across the LogoutRequest / Response / LogoutResponse builders. Escape any value
 * interpolated into element text or an attribute value to prevent XML-injection from SP/user data.
 */

/** Escape `&`, `<`, `>` for element text content. */
export function escapeXmlText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Escape for a double-quoted attribute value (text escaping + `"`). */
export function escapeXmlAttr(value: string): string {
	return escapeXmlText(value).replaceAll('"', '&quot;');
}
