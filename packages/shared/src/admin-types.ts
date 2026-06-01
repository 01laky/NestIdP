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
	counts: AdminStatsDto;
}
