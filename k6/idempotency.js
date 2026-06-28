import { check } from 'k6';
import { postTx, seedAccounts, transfer, uuidv4 } from './common.js';

export const options = {
  scenarios: {
    idempotency: {
      executor: 'constant-arrival-rate',
      rate: 500,
      timeUnit: '1s',
      duration: '8m',
      preAllocatedVUs: 200,
      maxVUs: 2000,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

// Pre-generated keys to replay
const KEYS = Array.from({ length: 5000 }, () => uuidv4());

export function setup() {
  return { accounts: seedAccounts(2, { namePrefix: 'idem' }) };
}

export default function (data) {
  const [a1, a2] = data.accounts;
  const key = Math.random() < 0.7 ? KEYS[Math.floor(Math.random() * KEYS.length)] : uuidv4();
  const res = postTx(transfer(a1, a2, 1, 'idempotency'), key);
  check(res, { 'post 201/409': (x) => x.status === 201 || x.status === 409 });
}
