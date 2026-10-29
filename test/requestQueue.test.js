import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { configureRequest, jiraJson } = await import('../src/api/requestQueue.js');
const requestJira = vi.fn();
configureRequest(requestJira);

const response = (status, body = {}, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k] ?? null },
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  vi.useFakeTimers();
  requestJira.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('jiraJson', () => {
  it('returns the parsed body and sends JSON headers', async () => {
    requestJira.mockResolvedValue(response(200, { a: 1 }));
    await expect(jiraJson('/x')).resolves.toEqual({ a: 1 });
    expect(requestJira.mock.calls[0][1].headers.Accept).toBe('application/json');
  });

  it('keeps at most 2 requests in flight', async () => {
    let active = 0;
    let peak = 0;
    requestJira.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return response(200);
    });
    const all = Promise.all([1, 2, 3, 4, 5].map(() => jiraJson('/x')));
    await vi.runAllTimersAsync();
    await all;
    expect(peak).toBe(2);
  });

  it('waits Retry-After seconds on 429 and reports it', async () => {
    requestJira.mockResolvedValueOnce(response(429, {}, { 'Retry-After': '7' })).mockResolvedValueOnce(response(200, { ok: 1 }));
    const onRetry = vi.fn();
    const p = jiraJson('/x', {}, onRetry);
    await vi.advanceTimersByTimeAsync(6999);
    expect(requestJira).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(onRetry).toHaveBeenCalledWith(7);
  });

  it('caps the jittered backoff at 30 seconds', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const waits = [];
    requestJira.mockResolvedValue(response(503));
    const p = jiraJson('/x', {}, (s) => waits.push(s)).catch((e) => e);
    await vi.runAllTimersAsync();
    await p;
    expect(Math.max(...waits)).toBeLessThanOrEqual(30);
    expect(waits[0]).toBeLessThanOrEqual(1);
  });

  it('gives up after 6 retries and throws with the status', async () => {
    requestJira.mockResolvedValue(response(429));
    const p = jiraJson('/x').catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(requestJira).toHaveBeenCalledTimes(7);
    expect(err.status).toBe(429);
  });

  it('throws the Assets error message on other 4xx without retrying', async () => {
    requestJira.mockResolvedValue(response(400, { errorMessages: ['Bad AQL'] }));
    await expect(jiraJson('/x')).rejects.toMatchObject({ message: 'Bad AQL', status: 400 });
    expect(requestJira).toHaveBeenCalledTimes(1);
  });
});
