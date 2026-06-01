import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ApiConnectionsAuditService {
	private readonly logger = new Logger(ApiConnectionsAuditService.name);

	logCreated(id: string, name: string): void {
		this.logger.log(JSON.stringify({ event: 'api_connection_created', id, name }));
	}

	logUpdated(id: string, name: string): void {
		this.logger.log(JSON.stringify({ event: 'api_connection_updated', id, name }));
	}

	logDeleted(id: string, name: string): void {
		this.logger.log(JSON.stringify({ event: 'api_connection_deleted', id, name }));
	}

	logTested(id: string, reachable: boolean, statusCode?: number): void {
		this.logger.log(
			JSON.stringify({
				event: 'api_connection_tested',
				id,
				reachable,
				statusCode: statusCode ?? null,
			}),
		);
	}
}
