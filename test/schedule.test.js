import { describe, expect, it } from 'vitest';
import {
  backupFileName, formatSize, describeDays, describeSchedule, forecastStored, formatDuration, formatNextRun, historySummary, nextRun, planHealth, storedTotals, validatePlanForm,
} from '../static/main/src/schedule.js';

const plan = (patch) => ({ enabled: true, days: [1, 2, 3, 4, 5, 6, 7], hour: 2, ...patch });

describe('describeSchedule', () => {
  it('names common day sets', () => {
    expect(describeDays([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
    expect(describeDays([5, 4, 3, 2, 1])).toBe('Weekdays');
    expect(describeDays([7, 6])).toBe('Weekends');
    expect(describeDays([5, 1, 3])).toBe('Mon, Wed, Fri');
    expect(describeSchedule([1], 22)).toBe('Mon at 22:00');
  });
});

describe('nextRun', () => {
  it('finds the next matching local hour', () => {
    // Mon 2026-10-26 00:30 UTC is 01:30 in Copenhagen; the 02:00 hour starts at 01:00 UTC.
    expect(nextRun(plan({}), new Date('2026-10-26T00:30:00Z')).toISOString()).toBe('2026-10-26T01:00:00.000Z');
  });

  it('moves to the next day once the hour has started', () => {
    expect(nextRun(plan({}), new Date('2026-10-26T01:10:00Z')).toISOString()).toBe('2026-10-27T01:00:00.000Z');
  });

  it('respects weekdays and a paused plan', () => {
    expect(nextRun(plan({ days: [3] }), new Date('2026-10-26T01:10:00Z')).toISOString()).toBe('2026-10-28T01:00:00.000Z');
    expect(nextRun(plan({ enabled: false }), new Date('2026-10-26T01:10:00Z'))).toBeNull();
  });
});

describe('formatting', () => {
  it('shows the hour a run starts within', () => {
    expect(formatNextRun(new Date('2026-10-27T01:00:00Z'), 2)).toBe('Tue 27 Oct, between 02:00 and 03:00');
    expect(formatNextRun(new Date('2026-10-27T22:00:00Z'), 23)).toBe('Tue 27 Oct, between 23:00 and 00:00');
  });

  it('formats durations', () => {
    expect(formatDuration('2026-10-26T01:00:00Z', '2026-10-26T01:00:13Z')).toBe('13 s');
    expect(formatDuration('2026-10-26T01:00:00Z', '2026-10-26T01:02:05Z')).toBe('2 min 5 s');
    expect(formatDuration('2026-10-26T01:00:00Z', undefined)).toBe('');
  });
});

describe('storage', () => {
  const ok = (size) => ({ status: 'ok', size });
  const backups = { a: [ok(100), ok(300), { status: 'failed' }, { status: 'running' }], b: [ok(50)] };

  it('totals only finished OK backups', () => {
    expect(storedTotals(backups)).toEqual({ count: 3, bytes: 450 });
    expect(storedTotals({})).toEqual({ count: 0, bytes: 0 });
  });

  it('forecasts the peak from the average size and the backups kept at once', () => {
    const plans = [
      { id: 'a', enabled: true, days: [1, 2, 3, 4, 5, 6, 7], retentionDays: 7 }, // 7 kept at once, average 200
      { id: 'b', enabled: true, days: [1], retentionDays: 1 }, // at least 1 kept
      { id: 'c', enabled: false, days: [1], retentionDays: 7 },
    ];
    expect(forecastStored(plans, backups)).toBe(7 * 200 + 50);
  });

  it('has no forecast without a finished backup', () => {
    expect(forecastStored([{ id: 'x', enabled: true, days: [1], retentionDays: 7 }], {})).toBeNull();
  });
});

describe('planHealth', () => {
  const active = { enabled: true };
  it('flags paused, failed and incomplete plans', () => {
    expect(planHealth({ enabled: false }, [{ status: 'failed' }])).toBe('paused');
    expect(planHealth(active, [])).toBe('new');
    expect(planHealth(active, [{ status: 'running' }])).toBe('new');
    expect(planHealth(active, [{ status: 'running' }, { status: 'failed' }])).toBe('failed');
    expect(planHealth(active, [{ status: 'ok', missingSchemas: ['GEO'] }])).toBe('incomplete');
    expect(planHealth(active, [{ status: 'ok', failedTypes: 2 }])).toBe('incomplete');
    expect(planHealth(active, [{ status: 'ok', missingSchemas: [], failedTypes: 0 }, { status: 'failed' }])).toBe('healthy');
  });
});

describe('historySummary', () => {
  it('keeps the newest runs, oldest first, and counts them in words', () => {
    const runs = [{ status: 'running' }, { status: 'ok' }, { status: 'failed' }, { status: 'ok' }];
    const { recent, text } = historySummary(runs, 3);
    expect(recent.map((r) => r.status)).toEqual(['failed', 'ok', 'running']);
    expect(text).toBe('1 completed, 1 failed, 1 running');
    expect(historySummary([]).text).toBe('No runs yet');
  });
});

describe('backupFileName', () => {
  it('uses the plan name and the Copenhagen start time', () => {
    expect(backupFileName('Nightly services', '2026-10-26T17:24:10Z')).toBe('assets-backup-nightly-services-2026-10-26-1824.zip');
    expect(backupFileName('Æble / Øst på Ærø!!', '2026-07-01T00:05:00Z')).toBe('assets-backup-aeble-oest-pa-aeroe-2026-07-01-0205.zip');
    expect(backupFileName('***', '2026-07-01T00:05:00Z')).toBe('assets-backup-plan-2026-07-01-0205.zip');
  });
});

describe('validatePlanForm', () => {
  const ok = { name: 'Nightly', schemaKeys: ['SVC'], days: [1], retentionDays: '7' };
  it('accepts a complete plan', () => {
    expect(validatePlanForm(ok)).toEqual({});
  });
  it('reports each problem on its field', () => {
    expect(validatePlanForm({ name: '  ', schemaKeys: [], days: [], retentionDays: '31' })).toEqual({
      name: 'Enter a plan name.',
      schemas: 'Choose at least one schema.',
      days: 'Choose at least one day.',
      retention: 'Enter a whole number of days from 1 to 30.',
    });
    expect(validatePlanForm({ ...ok, retentionDays: '2.5' }).retention).toBeDefined();
    expect(validatePlanForm({ ...ok, retentionDays: '' }).retention).toBeDefined();
  });
});

describe('formatSize', () => {
  it('shows zero as zero and small files as at least 1 KB', () => {
    expect(formatSize(0)).toBe('0 KB');
    expect(formatSize(10)).toBe('1 KB');
    expect(formatSize(35800)).toBe('35 KB');
    expect(formatSize(3480000)).toBe('3.3 MB');
    expect(formatSize(undefined)).toBe('');
  });
});
