import assert from 'node:assert'
import test, { suite } from 'node:test'
import { createServer } from './server.js'

const randomPort = Math.floor(Math.random() * (65535 - 1024)) + 1024

suite('server', _ => {
  test('lifecycle', async _ => {
    const server = createServer({
      publicDirectory: '/dev/null',
      errorPage: 'error.js',
      pageFilenameSuffix: '__page.js',
    })
    assert.deepEqual(await server.listen(randomPort), undefined)
    assert.deepEqual(await server.close(), undefined)
  })

  test('configuration defaults', async _ => {
    const server = createServer({
      publicDirectory: '/dev/null',
    })
    assert.deepEqual(await server.listen(randomPort), undefined)
    assert.deepEqual(await server.close(), undefined)
  })
})
