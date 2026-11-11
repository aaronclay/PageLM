## 2025-05-18 - Keyv SQLite N+1 Queries on Index Lookups
**Learning:** Keyv is backed by `@keyv/sqlite` in this codebase. Sequential `await db.get(...)` inside loops creates N+1 SQLite queries, resulting in high cumulative round-trip latency. `Keyv` provides native `db.getMany(keys: string[])` which fetches multiple keys in a single batch query.
**Action:** Always prefer `db.getMany` over looping `db.get` when fetching a set of IDs from an index array.
