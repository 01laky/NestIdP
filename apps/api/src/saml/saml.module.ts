import { Module } from '@nestjs/common';
import { SamlController } from './saml.controller';
import { SamlMetadataService } from './saml-metadata.service';
import { SamlPostBindingService } from './saml-post-binding.service';
import { SamlRequestParserService } from './saml-request-parser.service';
import { SamlResponseBuilderService } from './saml-response-builder.service';

@Module({
	controllers: [SamlController],
	providers: [
		SamlRequestParserService,
		SamlResponseBuilderService,
		SamlMetadataService,
		SamlPostBindingService,
	],
	exports: [
		SamlRequestParserService,
		SamlResponseBuilderService,
		SamlMetadataService,
		SamlPostBindingService,
	],
})
export class SamlModule {}
