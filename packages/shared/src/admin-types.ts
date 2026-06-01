export interface AdminStatsDto {
	users: number;
	groups: number;
	roles: number;
	apiConnections: number;
	spConnections: number;
}

export interface AdminStubResponseDto {
	status: 'stub';
	module: 'admin';
	note: string;
	apiConnectionsRoute: string;
	apiConnectionsApiPath: string;
	/** Admin REST path for manual identity sync (Prompt 05). */
	syncApiPath: string;
	counts: AdminStatsDto;
}
