import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class SamlPostBindingService {
	renderAutoPostForm(): never {
		throw new NotImplementedException('SAML POST binding is not implemented yet.');
	}
}
