import type { CollectionConfig } from 'payload'

export const FAILING_TITLE = 'fail'

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'status',
      type: 'text',
    },
  ],
  hooks: {
    beforeChange: [
      ({ operation, originalDoc }) => {
        if (operation === 'update' && originalDoc?.title === FAILING_TITLE) {
          throw new Error('This post cannot be updated')
        }
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        const post = await req.payload.findByID({ collection: 'posts', id, req })
        if (post.title !== FAILING_TITLE) return
        // Stands in for a hook that does async work before refusing, so the other posts are processed first.
        await new Promise((resolve) => setTimeout(resolve, 1000))
        throw new Error('This post cannot be deleted')
      },
    ],
  },
}
