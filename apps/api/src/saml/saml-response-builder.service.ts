import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class SamlResponseBuilderService {
	buildLoginResponse(): never {
		throw new NotImplementedException('SAML response building is not implemented yet.');
	}
}
