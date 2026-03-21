# Ledger Load & Performance Tests

k6 performance validation suite for the Distributed Ledger Platform.

## Scenarios

| Script                  | Purpose                        | Duration |
|-------------------------|--------------------------------|----------|
| smoke.js                | Quick health check             | ~30s     |
| baseline.js             | Standard throughput            | ~5m      |
| batch.js                | Batch transactions             | ~3m      |
| hotspot.js              | Hot account contention         | ~5m      |
| idempotency.js          | Idempotency replay             | ~3m      |
| read_after_write.js     | Consistency after writes       | ~3m      |
| spike.js                | Burst traffic                  | ~5m      |
| heavy_throughput.js     | Max throughput stress          | ~10m     |
| heavy_idempotency.js    | Heavy idempotency stress       | ~10m     |
| endurance.js            | 30-min soak test               | ~30m     |

## Usage

```bash
BASE_URL=http://localhost:8080 TENANT=t1 k6 run k6/smoke.js
```
