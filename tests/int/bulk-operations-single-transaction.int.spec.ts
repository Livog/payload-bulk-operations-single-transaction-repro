// @vitest-environment node
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FAILING_TITLE } from '@/collections/Posts'

const TITLES = ['a', 'b', FAILING_TITLE, 'c', 'd']

let replSet: MongoMemoryReplSet
let payload: Payload

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  process.env.DATABASE_URL = replSet.getUri('payload-bulk-repro')
  process.env.PAYLOAD_SECRET ||= 'payload-bulk-repro-secret'
  const { default: config } = await import('@/payload.config')
  payload = await getPayload({ config: await config })
  await Promise.all(Object.values(payload.db.collections).map((model) => model.init()))
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await replSet?.stop()
})

async function seedPosts(): Promise<string[]> {
  await payload.db.deleteMany({ collection: 'posts', where: {} })
  const ids: string[] = []
  for (const title of TITLES) {
    const post = await payload.create({ collection: 'posts', data: { title } })
    ids.push(String(post.id))
  }
  return ids
}

async function readPosts(ids: string[]) {
  const { docs } = await payload.find({
    collection: 'posts',
    where: { id: { in: ids } },
    pagination: false,
    sort: 'createdAt',
  })
  return docs
}

function titles(docs: { title?: string | null }[]): string[] {
  return docs.map(({ title }) => title ?? '').sort()
}

describe('bulkOperationsSingleTransaction: true (MongoDB replica set)', () => {
  it('bulk update: every post returned in docs is updated in the database', async () => {
    const ids = await seedPosts()

    const result = await payload.update({
      collection: 'posts',
      where: { id: { in: ids } },
      sort: 'createdAt',
      data: { status: 'archived' },
    })
    const stored = await readPosts(ids)

    console.log('bulk update', {
      reportedUpdated: titles(result.docs),
      reportedErrors: result.errors.map(({ message }) => message),
      actuallyArchived: titles(stored.filter(({ status }) => status === 'archived')),
      notArchived: titles(stored.filter(({ status }) => status !== 'archived')),
    })

    expect(titles(result.docs)).toEqual(['a', 'b', 'c', 'd'])
    expect(titles(stored.filter(({ status }) => status === 'archived'))).toEqual(titles(result.docs))
  })

  it('bulk delete: every post returned in docs is deleted from the database', async () => {
    const ids = await seedPosts()

    const result = await payload.delete({
      collection: 'posts',
      where: { id: { in: ids } },
    })
    const stored = await readPosts(ids)

    console.log('bulk delete', {
      reportedDeleted: titles(result.docs),
      reportedErrors: result.errors.map(({ message }) => message),
      stillInDatabase: titles(stored),
    })

    expect(titles(result.docs)).toEqual(['a', 'b', 'c', 'd'])
    expect(titles(stored)).toEqual([FAILING_TITLE])
  })
})
