let request = () => {
  throw new Error('Request function is not configured');
};

// The caller injects how a Jira path is requested (asApp in the backend, a mock in tests).
export function configureRequest(fn) {
  request = fn;
}

const MAX_IN_FLIGHT = 2;
const MAX_RETRIES = 6;
let inFlight = 0;
const waiters = [];

async function acquire() {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return;
  }
  await new Promise((resolve) => waiters.push(resolve));
  inFlight++;
}

function release() {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function jiraJson(path, options = {}, onRetry) {
  await acquire();
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await request(path, {
        ...options,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers },
      });
      if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const backoff = Math.min(30000, 1000 * 2 ** attempt);
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.random() * backoff;
        onRetry?.(Math.ceil(waitMs / 1000));
        await sleep(waitMs);
        continue;
      }
      const body = parseBody(await res.text());
      if (!res.ok) {
        const message = body?.errorMessages?.join('; ') || body?.message || `HTTP ${res.status}`;
        const err = new Error(message);
        err.status = res.status;
        throw err;
      }
      return body;
    }
  } finally {
    release();
  }
}
