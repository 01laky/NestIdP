import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiConnectionScheduleDto, UpdateScheduleRequestDto } from '@nestidp/shared';
import {
	CronScheduleError,
	SYNC_SCHEDULE_DEFAULT_MIN_INTERVAL_MINUTES,
	SYNC_SCHEDULE_DEFAULT_TIMEZONE,
	SYNC_SCHEDULE_PRESETS,
	SYNC_SCHEDULE_PREVIEW_COUNT,
	nextCronRuns,
	validateCronSchedule,
} from '@nestidp/shared';
import {
	AdminApiError,
	getSyncSchedule,
	triggerIdentitySync,
	updateSyncSchedule,
} from '../../adminApi';
import { Badge } from '../../../ui';
import { Button, Checkbox, Panel, Select, TextInput, useConfirm, useToast } from '../../../ui';

const CUSTOM_PRESET = '__custom__';

/** A curated timezone list (full IANA set when the runtime exposes it). */
function timezoneOptions(current: string | null): string[] {
	const supported =
		typeof (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf ===
		'function'
			? (Intl as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
			: ['UTC', 'Europe/London', 'Europe/Bratislava', 'Europe/Berlin', 'America/New_York'];
	const list = supported.includes('UTC') ? supported : ['UTC', ...supported];
	if (current && !list.includes(current)) {
		return [current, ...list];
	}
	return list;
}

function operatorTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || SYNC_SCHEDULE_DEFAULT_TIMEZONE;
	} catch {
		return SYNC_SCHEDULE_DEFAULT_TIMEZONE;
	}
}

function formatInZone(iso: string, timeZone: string): string {
	try {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone,
		}).format(new Date(iso));
	} catch {
		return iso;
	}
}

export function ScheduleSection({ connectionId }: { connectionId: string }) {
	const { t } = useTranslation('sync');
	const { t: tCommon } = useTranslation('common');
	const { showToast } = useToast();
	const confirm = useConfirm();

	const [schedule, setSchedule] = useState<ApiConnectionScheduleDto | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [enabled, setEnabled] = useState(false);
	const [paused, setPaused] = useState(false);
	const [dryRun, setDryRun] = useState(false);
	const [cron, setCron] = useState('');
	const [timezone, setTimezone] = useState(SYNC_SCHEDULE_DEFAULT_TIMEZONE);
	const [cronError, setCronError] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [running, setRunning] = useState(false);

	function applySchedule(dto: ApiConnectionScheduleDto) {
		setSchedule(dto);
		setEnabled(dto.scheduleEnabled);
		setPaused(dto.schedulePaused);
		setDryRun(dto.scheduleDryRun);
		setCron(dto.scheduleCron ?? '');
		setTimezone(dto.scheduleTimezone ?? SYNC_SCHEDULE_DEFAULT_TIMEZONE);
	}

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const res = await getSyncSchedule(connectionId);
				if (!cancelled) {
					applySchedule(res.schedule);
				}
			} catch {
				if (!cancelled) {
					setLoadError(t('schedule.loadFailed'));
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [connectionId, t]);

	const localTz = useMemo(() => operatorTimezone(), []);
	const tzOptions = useMemo(() => timezoneOptions(timezone), [timezone]);
	const selectedPreset = useMemo(() => {
		const match = SYNC_SCHEDULE_PRESETS.find((p) => p.cron === cron);
		return match?.id ?? CUSTOM_PRESET;
	}, [cron]);

	// Client-side preview + min-interval validation (server is authoritative).
	const preview = useMemo(() => {
		if (!cron.trim()) {
			return { runs: [] as string[], error: null as string | null };
		}
		try {
			validateCronSchedule(cron, timezone, SYNC_SCHEDULE_DEFAULT_MIN_INTERVAL_MINUTES);
			const runs = nextCronRuns(cron, timezone, SYNC_SCHEDULE_PREVIEW_COUNT).map((d) =>
				d.toISOString(),
			);
			return { runs, error: null };
		} catch (err) {
			return {
				runs: [] as string[],
				error: err instanceof CronScheduleError ? err.message : t('schedule.invalidCron'),
			};
		}
	}, [cron, timezone, t]);

	useEffect(() => {
		setCronError(enabled && cron.trim() ? preview.error : null);
	}, [enabled, cron, preview.error]);

	function onPresetChange(value: string) {
		if (value === CUSTOM_PRESET) {
			return;
		}
		const preset = SYNC_SCHEDULE_PRESETS.find((p) => p.id === value);
		if (preset) {
			setCron(preset.cron);
		}
	}

	async function handleSave() {
		setSaveError(null);
		if (enabled && preview.error) {
			setCronError(preview.error);
			return;
		}
		setSaving(true);
		try {
			const body: UpdateScheduleRequestDto = {
				scheduleEnabled: enabled,
				schedulePaused: paused,
				scheduleDryRun: dryRun,
				scheduleCron: cron.trim() ? cron.trim() : null,
				scheduleTimezone: timezone,
			};
			const res = await updateSyncSchedule(connectionId, body);
			applySchedule(res.schedule);
			showToast(t('schedule.saved'));
		} catch (err) {
			setSaveError(err instanceof AdminApiError ? err.message : t('schedule.saveFailed'));
		} finally {
			setSaving(false);
		}
	}

	async function handleRunNow() {
		const ok = await confirm({
			title: t('schedule.runNow'),
			description: t('confirmFullSync'),
			tone: 'warning',
			showAuditNote: true,
			confirmLabel: t('schedule.runNow'),
		});
		if (!ok) {
			return;
		}
		setRunning(true);
		try {
			await triggerIdentitySync(connectionId, {});
			showToast(t('toastSyncFinished'));
			const res = await getSyncSchedule(connectionId);
			applySchedule(res.schedule);
		} catch (err) {
			setSaveError(err instanceof AdminApiError ? err.message : t('syncFailed'));
		} finally {
			setRunning(false);
		}
	}

	const previewTimezones = timezone === localTz ? [timezone] : [timezone, localTz];

	return (
		<Panel title={t('schedule.sectionTitle')}>
			{loadError ? <p className="evg-field__error">{loadError}</p> : null}
			<div className="evg-stack">
				<Checkbox label={t('schedule.enableLabel')} checked={enabled} onChange={setEnabled} />
				<fieldset className="evg-stack" disabled={!enabled}>
					<Select
						label={t('schedule.presetLabel')}
						value={selectedPreset}
						onChange={(e) => onPresetChange(e.target.value)}
					>
						<option value={CUSTOM_PRESET}>{t('schedule.presetCustom')}</option>
						{SYNC_SCHEDULE_PRESETS.map((p) => (
							<option key={p.id} value={p.id}>
								{t(p.labelKey)}
							</option>
						))}
					</Select>
					<TextInput
						label={t('schedule.cronLabel')}
						hint={t('schedule.cronHint', { minutes: SYNC_SCHEDULE_DEFAULT_MIN_INTERVAL_MINUTES })}
						value={cron}
						onChange={(e) => setCron(e.target.value)}
						error={cronError ?? undefined}
						placeholder="*/15 * * * *"
						spellCheck={false}
						autoComplete="off"
					/>
					<Select
						label={t('schedule.timezoneLabel')}
						value={timezone}
						onChange={(e) => setTimezone(e.target.value)}
					>
						{tzOptions.map((tz) => (
							<option key={tz} value={tz}>
								{tz}
							</option>
						))}
					</Select>
					<Checkbox label={t('schedule.pausedLabel')} checked={paused} onChange={setPaused} />
					<Checkbox label={t('schedule.dryRunLabel')} checked={dryRun} onChange={setDryRun} />

					{cron.trim() ? (
						<div className="evg-stack">
							{previewTimezones.map((tz) => (
								<div key={tz}>
									<p className="evg-field__label">
										{tz === localTz && tz !== timezone
											? t('schedule.nextRunsLocal', { tz })
											: t('schedule.nextRuns', { tz })}
									</p>
									{preview.runs.length === 0 ? (
										<p className="evg-muted">{t('schedule.noPreview')}</p>
									) : (
										<ul className="evg-list">
											{preview.runs.map((iso) => (
												<li key={`${tz}-${iso}`}>{formatInZone(iso, tz)}</li>
											))}
										</ul>
									)}
								</div>
							))}
						</div>
					) : null}
				</fieldset>

				{saveError ? <p className="evg-field__error">{saveError}</p> : null}
				<div className="evg-actions">
					<Button
						type="button"
						variant="primary"
						onClick={() => void handleSave()}
						disabled={saving}
					>
						{saving ? tCommon('saving') : t('schedule.save')}
					</Button>
					<Button
						type="button"
						variant="secondary"
						onClick={() => void handleRunNow()}
						disabled={running}
					>
						{running ? tCommon('running') : t('schedule.runNow')}
					</Button>
				</div>
			</div>

			{schedule ? <ScheduleStatus schedule={schedule} /> : null}
		</Panel>
	);
}

function ScheduleStatus({ schedule }: { schedule: ApiConnectionScheduleDto }) {
	const { t } = useTranslation('sync');
	const { t: tCommon } = useTranslation('common');
	const localTz = useMemo(() => operatorTimezone(), []);
	return (
		<div className="evg-stack" data-testid="schedule-status">
			<h4>{t('schedule.statusTitle')}</h4>
			{schedule.scheduleAutoPausedAt ? (
				<p className="evg-field__error">{t('schedule.autoPaused')}</p>
			) : null}
			{schedule.scheduleLastError ? (
				<p className="evg-field__error">
					{t('schedule.lastError')}: {schedule.scheduleLastError}
				</p>
			) : null}
			<ul className="evg-dl">
				<li>
					<span>{t('schedule.nextRunAt')}</span>
					<span>
						{schedule.nextRunAt ? formatInZone(schedule.nextRunAt, localTz) : t('schedule.none')}
					</span>
				</li>
				<li>
					<span>{t('schedule.lastScheduledRunAt')}</span>
					<span>
						{schedule.lastScheduledRunAt
							? formatInZone(schedule.lastScheduledRunAt, localTz)
							: t('schedule.none')}
					</span>
				</li>
				<li>
					<span>{t('schedule.lastScheduledRunStatus')}</span>
					<span>
						{schedule.lastScheduledRunStatus ? (
							<Badge variant={schedule.lastScheduledRunStatus === 'SUCCESS' ? 'success' : 'danger'}>
								{schedule.lastScheduledRunStatus}
							</Badge>
						) : (
							tCommon('never')
						)}
					</span>
				</li>
				<li>
					<span>{t('schedule.consecutiveFailures')}</span>
					<span>{schedule.scheduleConsecutiveFailures}</span>
				</li>
			</ul>
		</div>
	);
}
