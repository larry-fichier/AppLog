const MAX_ATTEMPTS    = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface AttemptRecord {
  count: number;
  lockedUntil: number | null;
}

const store = new Map<string, AttemptRecord>();

export function checkLock(identifier: string): { locked: boolean; remainingSeconds?: number } {
  const record = store.get(identifier.toLowerCase());
  if (!record?.lockedUntil) return { locked: false };
  if (Date.now() < record.lockedUntil) {
    return {
      locked: true,
      remainingSeconds: Math.ceil((record.lockedUntil - Date.now()) / 1000),
    };
  }
  store.delete(identifier.toLowerCase());
  return { locked: false };
}

export function recordFailure(identifier: string): void {
  const key = identifier.toLowerCase();
  const record = store.get(key) ?? { count: 0, lockedUntil: null };
  record.count++;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCK_DURATION_MS;
    record.count = 0;
  }
  store.set(key, record);
}

export function recordSuccess(identifier: string): void {
  store.delete(identifier.toLowerCase());
}

export function remainingAttempts(identifier: string): number {
  const record = store.get(identifier.toLowerCase());
  if (!record) return MAX_ATTEMPTS;
  return Math.max(0, MAX_ATTEMPTS - record.count);
}
