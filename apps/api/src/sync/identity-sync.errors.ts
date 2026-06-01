export class IdentitySyncHttpError extends Error {
	constructor(
		message: string,
		public readonly options: {
			statusCode?: number;
			url?: string;
			reachable?: boolean;
		} = {},
	) {
		super(message);
		this.name = 'IdentitySyncHttpError';
	}
}

export class IdentitySyncDecryptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IdentitySyncDecryptError';
	}
}
