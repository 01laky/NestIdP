-- Prompt 39 D5: persist orphan-deactivation counts on SyncLog.
-- Nullable on purpose: historical rows have no data; new runs always write numbers
-- (0 on dry runs and early failures). One statement per `;` (docs/migrations.md).
ALTER TABLE "SyncLog" ADD COLUMN "groupsDeactivated" INTEGER;
ALTER TABLE "SyncLog" ADD COLUMN "rolesDeactivated" INTEGER;
