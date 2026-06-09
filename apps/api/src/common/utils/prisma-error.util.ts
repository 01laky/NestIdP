/**
 * True when an unknown thrown value is a Prisma unique-constraint violation (P2002) (Prompt 38 §A4 / §6).
 * Single source of truth — this `code === 'P2002'` shape-check was duplicated as a private method in the
 * SAML SSO and logout services. Structural (does not import `Prisma`) so it works for any error carrying a
 * `code` property.
 */
export function isUniqueConstraintError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code: string }).code === 'P2002'
	);
}
