import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SpConnectionsAuditService {
	private readonly logger = new Logger(SpConnectionsAuditService.name);

	logCreated(id: string, spEntityId: string): void {
		this.logger.log(JSON.stringify({ event: 'sp_connection_created', id, spEntityId }));
	}

	logUpdated(id: string, spEntityId: string): void {
		this.logger.log(JSON.stringify({ event: 'sp_connection_updated', id, spEntityId }));
	}

	logDeleted(id: string, spEntityId: string): void {
		this.logger.log(JSON.stringify({ event: 'sp_connection_deleted', id, spEntityId }));
	}

	logAcsTested(id: string, reachable: boolean, statusCode?: number): void {
		this.logger.log(
			JSON.stringify({
				event: 'sp_connection_acs_tested',
				id,
				reachable,
				statusCode: statusCode ?? null,
			}),
		);
	}
}
