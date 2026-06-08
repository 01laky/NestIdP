import 'reflect-metadata';

// Brute-force protection (Prompt 35) is ON by default in production, but the persistent account lockout
// and the in-memory IP ban would otherwise leak across the shared test usernames (e.g. `alice`) and
// interfere with the pre-existing per-IP / per-username throttle integration tests. Default both layers
// OFF for tests; the dedicated lockout/ban specs drive the services directly with explicit thresholds.
process.env.LOGIN_LOCKOUT_THRESHOLD = process.env.LOGIN_LOCKOUT_THRESHOLD ?? '0';
process.env.LOGIN_IP_BAN_THRESHOLD = process.env.LOGIN_IP_BAN_THRESHOLD ?? '0';
process.env.LOGIN_LOCKOUT_PRUNE_INTERVAL_MS = process.env.LOGIN_LOCKOUT_PRUNE_INTERVAL_MS ?? '0';
