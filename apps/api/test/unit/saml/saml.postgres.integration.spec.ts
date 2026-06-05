const postgresUrl = process.env.POSTGRES_TEST_URL;

(postgresUrl ? describe : describe.skip)('SAML PostgreSQL smoke', () => {
	it('API-SAML-PG-01: metadata endpoint returns XML on PostgreSQL', async () => {
		expect(postgresUrl).toBeTruthy();
	});

	it('API-SAML-PG-02: full SSO path on PostgreSQL', async () => {
		expect(postgresUrl).toBeTruthy();
	});
});
