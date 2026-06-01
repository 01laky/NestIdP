#!/usr/bin/env node
/**
 * Build a SP-initiated SAML HTTP-Redirect URL for manual NestIdP SSO testing.
 *
 * Usage:
 *   IDP_BASE_URL=http://localhost:3000 \
 *   SP_ENTITY_ID=urn:test:sp:entity-id \
 *   SP_ACS_URL=http://localhost:4000/acs \
 *   node docs/examples/saml-sp-initiated-redirect.mjs
 */

import { deflateRawSync } from 'node:zlib';

const idpBaseUrl = (process.env.IDP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const spEntityId = process.env.SP_ENTITY_ID ?? 'urn:test:sp:entity-id';
const spAcsUrl = process.env.SP_ACS_URL ?? 'http://localhost:4000/acs';
const relayState = process.env.RELAY_STATE;

const requestId = `_mock-${Date.now()}`;
const issueInstant = new Date().toISOString();
const destination = `${idpBaseUrl}/saml/sso`;

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${requestId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${destination}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect">
  <saml:Issuer>${spEntityId}</saml:Issuer>
</samlp:AuthnRequest>`;

const samlRequest = encodeURIComponent(
	deflateRawSync(Buffer.from(xml, 'utf8')).toString('base64'),
);

const params = new URLSearchParams({ SAMLRequest: samlRequest });
if (relayState) {
	params.set('RelayState', relayState);
}

const url = `${destination}?${params.toString()}`;

console.log('Open this URL in a browser (IdP must be running):');
console.log(url);
console.log('');
console.log('After login, the IdP POSTs SAMLResponse to ACS:', spAcsUrl);
