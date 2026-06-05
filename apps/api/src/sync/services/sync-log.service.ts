import { Injectable } from '@nestjs/common';
import type { SyncLogErrorEntryDto } from '@nestidp/shared';
import { Prisma, SyncLog, SyncLogStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { toSyncLogDto } from '../mappers/sync.mapper';

const MAX_SYNC_ERRORS = 100;

@Injectable()
export class SyncLogService {
	constructor(private readonly prisma: PrismaService) {}

	createRunningLog(apiConnectionId: string): Promise<SyncLog> {
		return this.prisma.syncLog.create({
			data: {
				apiConnectionId,
				status: 'RUNNING',
			},
		});
	}

	async finishLog(
		logId: string,
		status: SyncLogStatus,
		counters: { usersSynced: number; groupsSynced: number; rolesSynced: number },
		errors: SyncLogErrorEntryDto[] | null,
	): Promise<SyncLog> {
		const cappedErrors = capSyncErrors(errors);
		return this.prisma.syncLog.update({
			where: { id: logId },
			data: {
				status,
				finishedAt: new Date(),
				usersSynced: counters.usersSynced,
				groupsSynced: counters.groupsSynced,
				rolesSynced: counters.rolesSynced,
				errors:
					cappedErrors == null
						? Prisma.JsonNull
						: (cappedErrors as unknown as Prisma.InputJsonValue),
			},
		});
	}

	async listLogsForConnection(connectionId: string, limit: number): Promise<SyncLog[]> {
		return this.prisma.syncLog.findMany({
			where: { apiConnectionId: connectionId },
			orderBy: { startedAt: 'desc' },
			take: limit,
		});
	}

	async getLogById(syncLogId: string): Promise<SyncLog | null> {
		return this.prisma.syncLog.findUnique({ where: { id: syncLogId } });
	}

	async getLatestLogForConnection(connectionId: string): Promise<SyncLog | null> {
		return this.prisma.syncLog.findFirst({
			where: { apiConnectionId: connectionId },
			orderBy: { startedAt: 'desc' },
		});
	}

	async getOpenRunningLog(connectionId: string): Promise<SyncLog | null> {
		return this.prisma.syncLog.findFirst({
			where: {
				apiConnectionId: connectionId,
				status: 'RUNNING',
				finishedAt: null,
			},
			orderBy: { startedAt: 'desc' },
		});
	}

	toDto(row: SyncLog) {
		return toSyncLogDto(row);
	}
}

export function capSyncErrors(
	errors: SyncLogErrorEntryDto[] | null,
): SyncLogErrorEntryDto[] | null {
	if (errors == null || errors.length === 0) {
		return null;
	}
	if (errors.length <= MAX_SYNC_ERRORS) {
		return errors;
	}
	return [
		...errors.slice(0, MAX_SYNC_ERRORS - 1),
		{ phase: 'parse_users', message: 'Additional errors truncated' },
	];
}

export function appendSyncError(
	errors: SyncLogErrorEntryDto[],
	entry: SyncLogErrorEntryDto,
): SyncLogErrorEntryDto[] {
	const next = [...errors, entry];
	return capSyncErrors(next) ?? next;
}
