import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class SamlRequestParserService {
	parseRedirectRequest(_encodedRequest: string): never {
		void _encodedRequest;
		throw new NotImplementedException('SAML request parsing is not implemented yet.');
	}
}
