import { Injectable } from '@nestjs/common';
import { RELAY_STATE_POST_FIELD, SAML_RESPONSE_POST_FIELD } from '@nestidp/shared';

@Injectable()
export class SamlPostBindingService {
	renderAutoPostForm(acsUrl: string, samlResponseBase64: string, relayState?: string): string {
		const action = escapeHtml(acsUrl);
		const responseValue = escapeHtml(samlResponseBase64);
		const relayInput =
			relayState != null && relayState.length > 0
				? `<input type="hidden" name="${RELAY_STATE_POST_FIELD}" value="${escapeHtml(relayState)}"/>`
				: '';

		return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>SSO Redirect</title></head>
<body onload="document.forms[0].submit()">
<form method="post" action="${action}">
<input type="hidden" name="${SAML_RESPONSE_POST_FIELD}" value="${responseValue}"/>
${relayInput}
<noscript><p>Click Continue to sign in.</p><button type="submit">Continue</button></noscript>
</form>
</body>
</html>`;
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
