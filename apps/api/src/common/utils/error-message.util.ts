/**
 * Extract a human-readable message from an unknown thrown value (Prompt 38 §A4 / §6). Single source of
 * truth for the `error instanceof Error ? error.message : String(error)` idiom that was duplicated as a
 * private `messageOf` across the back-channel SOAP service, the logout-propagation engine and the sync
 * scheduler (and inline elsewhere).
 */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
