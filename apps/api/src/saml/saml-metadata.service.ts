import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class SamlMetadataService {
	generateMetadata(): never {
		throw new NotImplementedException('SAML metadata generation is not implemented yet.');
	}
}
