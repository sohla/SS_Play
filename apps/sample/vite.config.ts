import { defineSSApp } from '@ss/vite-preset'

export default defineSSApp({
  name: 'sample',
  basePath: '/sample/',
  port: 3036,
  // One sample shipped with the page, so it does something before anything has
  // been pushed to the store — and so the e2e suite can assert sound without
  // depending on a directory outside the repo.
  samples: ['ambi_choir.flac'],
})
