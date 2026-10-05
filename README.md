# bulkOperationsSingleTransaction reports rolled-back documents as updated and deleted

Minimal reproduction for Payload `3.90.2`, created with `create-payload-app -t blank` (MongoDB).

`mongooseAdapter({ bulkOperationsSingleTransaction: true })` is documented as processing bulk update and delete documents "one at a time in separate transactions". It is also on by default in the DocumentDB and Cosmos DB compatibility options. With it on, one failing document rolls back other documents that the operation still returns in `docs` as updated or deleted.

## Run

```bash
pnpm install
pnpm test:int
```

Nothing to set up: the test starts a single-node MongoDB 7.0.24 replica set with `mongodb-memory-server`. The two tests fail on `3.90.2`.

## What the reproduction does

- `src/payload.config.ts` turns on `bulkOperationsSingleTransaction`.
- `src/collections/Posts.ts` adds a `posts` collection whose hooks refuse to update or delete the post titled `fail`. The delete hook waits one second before refusing, standing in for a hook that does async work, so the other posts are processed first.
- `tests/int/bulk-operations-single-transaction.int.spec.ts` creates the posts `a`, `b`, `fail`, `c`, `d` in that order, then:
  1. bulk updates all five, sorted by `createdAt`, with `status: 'archived'`
  2. bulk deletes all five

  It then compares what Payload returns with what is in the database.

## Expected

Each document has its own transaction, so `fail` only affects itself:

- Bulk update: `docs` is `a, b, c, d`, `errors` has `fail`, and `a, b, c, d` are archived.
- Bulk delete: `docs` is `a, b, c, d`, `errors` has `fail`, and only `fail` is left in the database.

## Actual

```text
bulk update {
  reportedUpdated: [ 'a', 'b', 'c', 'd' ],
  reportedErrors: [ 'This post cannot be updated' ],
  actuallyArchived: [ 'c', 'd' ],
  notArchived: [ 'a', 'b', 'fail' ]
}
bulk delete {
  reportedDeleted: [ 'a', 'b', 'c', 'd' ],
  reportedErrors: [ 'This post cannot be deleted' ],
  stillInDatabase: [ 'a', 'b', 'c', 'd', 'fail' ]
}
```

## Where it happens (`payload@3.90.2`, `dist/collections/operations`)

- `update.js:37` and `delete.js:28` start one transaction for the whole operation. The per-document `initTransaction(req)` (`update.js:206`, `delete.js:92`) then returns `false`, because `req` already has that transaction, so no document gets its own.
- When a document fails, its `catch` calls `killTransaction(req)` (`update.js:291`, `delete.js:225`). That rolls back the shared transaction, including documents already returned in `docs`, and removes it from `req`, so the documents after it start their own transactions.
- `delete.js:85` starts every document at once (`docs.map(async ...)`), so the "sequential" loop at `delete.js:238-242` only awaits documents that are already running.

Skipping the operation-level transaction when `bulkOperationsSingleTransaction` is on (as `delete.js` in `4.0.0-canary.37` already does) and running the delete documents one after another makes both tests pass.
