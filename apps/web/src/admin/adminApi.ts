// Barrel for the admin API client (Prompt 38 §6.9). The implementation is split into domain modules under
// `./adminApi/`; this file re-exports them so existing `import … from '../adminApi'` sites (and the
// `vi.spyOn(adminApi, …)` test pattern) keep working unchanged.
export * from './adminApi/core';
export * from './adminApi/auth';
export * from './adminApi/api-connections';
export * from './adminApi/sp-connections';
export * from './adminApi/sync';
export * from './adminApi/saml-sessions';
export * from './adminApi/identity';
export * from './adminApi/idp-settings';
export * from './adminApi/audit';
export * from './adminApi/external-db';
