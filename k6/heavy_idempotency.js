/**
 * Heavy Idempotency Stress Test
 *
 * This test hammers the system with massive idempotency replay storms.
 * Goal: Verify that under extreme replay pressure:
 * - No duplicate transactions are created
 * - Balances remain correct
 * - p95 latency stays acceptable
 * - The system correctly returns 201 for first request and replays for subsequent
 *
 * Run: BASE_URL=http://localhost:8080 TENANT=t1 k6 run k6/heavy_idempotency.js
 */
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { postTx, getBalance, seedAccounts, transfer, uuidv4 } from './common.js';

// Custom metrics
const replayCounter = new Counter('idempotency_replays');
const newPostCounter = new Counter('idempotency_new_posts');
const conflictCounter = new Counter('idempotency_conflicts');
const balanceCheckRate = new Rate('balance_correctness');
const replayLatency = new Trend('replay_latency_ms');
const newPostLatency = new Trend('new_post_latency_ms');

export const options = {
  scenarios: {
    // Phase 1: Sustained replay storm (70% replays, 30% new)
    replay_storm: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 300,
      maxVUs: 3000,
      stages: [
        { target: 300, duration: '20s' },
        { target: 800, duration: '20s' },
        { target: 1200, duration: '40s' },
        { target: 800, duration: '20s' },
        { target: 200, duration: '20s' },
      ],
      exec: 'replayStorm',
    },
    // Phase 2: Concurrent identical keys from multiple VUs
    concurrent_duplicates: {
      executor: 'constant-vus',
      vus: 100,
      duration: '90s',
      startTime: '20s',
      exec: 'concurrentDuplicates',
    },
    // Phase 3: Balance verification throughout
    balance_checker: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 30,
      maxVUs: 50,
      exec: 'verifyBalances',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    idempotency_conflicts: ['count==0'],
    balance_correctness: ['rate>0.99'],
  },
};

// Pre-generate keys for heavy replay
const REPLAY_KEYS = Array.from({ length: 10000 }, () => uuidv4());
// Small set of keys that will be hammered by concurrent VUs
const HOT_KEYS = Array.from({ length: 50 }, () => uuidv4());

export function setup() {
  // Two fixed accounts so balances stay deterministic for verification.
  return { accounts: seedAccounts(2, { namePrefix: 'heavy-idem' }) };
}

export function replayStorm(data) {
  const [a1, a2] = data.accounts;
  const isReplay = Math.random() < 0.7;
  const key = isReplay
    ? REPLAY_KEYS[Math.floor(Math.random() * REPLAY_KEYS.length)]
    : uuidv4();

  const start = Date.now();
  const res = postTx(transfer(a1, a2, 1, 'heavy_idempotency'), key);
  const elapsed = Date.now() - start;

  if (res.status === 201) {
    newPostCounter.add(1);
    newPostLatency.add(elapsed);
  } else if (res.status === 409) {
    conflictCounter.add(1);
  } else {
    replayCounter.add(1);
    replayLatency.add(elapsed);
  }

  check(res, {
    'response is 201 or replay': (r) => r.status === 201 || r.status === 409 || r.status === 200,
  });
}

export function concurrentDuplicates(data) {
  const [a1, a2] = data.accounts;
  const key = HOT_KEYS[Math.floor(Math.random() * HOT_KEYS.length)];

  const res = postTx(transfer(a1, a2, 1, 'heavy_idempotency'), key);

  check(res, {
    'concurrent dup handled': (r) => r.status === 201 || r.status === 409 || r.status === 200,
    'no 500 errors': (r) => r.status !== 500,
  });

  sleep(0.05);
}

export function verifyBalances(data) {
  const [a1, a2] = data.accounts;
  group('balance_verification', () => {
    // The two balances are read in separate, non-atomic calls. Under concurrent
    // posting they can reflect different points in time, so a naive |a1| == |a2|
    // check is racy. Every transaction in this 2-account system touches BOTH
    // accounts, so we bracket the a2 read with two a1 reads: if a1's version is
    // unchanged across the window, nothing committed and the snapshot is
    // consistent — only then do we assert. Otherwise the sample is inconclusive
    // and skipped (not counted as a failure).
    const r1a = getBalance(a1);
    const r2 = getBalance(a2);
    const r1b = getBalance(a1);

    if (r1a.status === 200 && r2.status === 200 && r1b.status === 200) {
      try {
        const b1a = r1a.json();
        const b2 = r2.json();
        const b1b = r1b.json();
        if (b1a.version !== b1b.version) {
          return; // a1 changed during the window — inconclusive snapshot
        }
        const balanced = Math.abs(b1a.postedBalanceMinor) === Math.abs(b2.postedBalanceMinor);
        balanceCheckRate.add(balanced);
        if (!balanced) {
          console.warn(`Balance mismatch: ${a1}=${b1a.postedBalanceMinor} ${a2}=${b2.postedBalanceMinor}`);
        }
      } catch (e) {
        balanceCheckRate.add(false);
      }
    }
  });

  sleep(1);
}
