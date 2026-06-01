// Prompt 03: seed AdminUser from ADMIN_USERNAME / ADMIN_PASSWORD
// Prompt 03+: seed IdpSettings row from IDP_BASE_URL

async function main(): Promise<void> {
	// intentionally empty — do not seed in v0.2.0
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
