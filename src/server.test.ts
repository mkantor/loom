import assert from 'node:assert'
import net from 'node:net'
import test, { suite } from 'node:test'
import { createServer } from './server.js'

const getArbitraryPort = () => Math.floor(Math.random() * (65535 - 1024)) + 1024

const isPortTaken = (port: number) =>
  new Promise<boolean>((resolve, reject) => {
    const probe = net
      .createServer()
      .once('listening', () =>
        probe.once('close', () => resolve(false)).close(),
      )
      .once('error', error =>
        'code' in error && error.code == 'EADDRINUSE'
          ? resolve(true)
          : reject(error),
      )
      .listen(port)
  })

const getAvailablePort = async () => {
  let remainingAttempts = 10 // Try up to this many ports before giving up.
  while (remainingAttempts > 0) {
    remainingAttempts = remainingAttempts - 1
    const arbitraryPort = getArbitraryPort()
    const portIsTaken = await isPortTaken(arbitraryPort)
    if (!portIsTaken) {
      return arbitraryPort
      break
    }
  }
  throw new Error('Could not find an available port')
}

suite('server', _ => {
  test('lifecycle', async _ => {
    const availablePort = await getAvailablePort()
    const server = createServer({
      publicDirectory: '/dev/null',
      errorHandler: 'error.js',
      handlerFilenameSuffix: '__page.js',
    })
    assert.deepEqual(await server.listen(availablePort), undefined)
    assert.deepEqual(await server.close(), undefined)
  })

  test('configuration defaults', async _ => {
    const availablePort = await getAvailablePort()
    const server = createServer({
      publicDirectory: '/dev/null',
    })
    assert.deepEqual(await server.listen(availablePort), undefined)
    assert.deepEqual(await server.close(), undefined)
  })

  test('request handling with pages', async _ => {
    const availablePort = await getAvailablePort()
    const server = createServer({
      publicDirectory: `${
        import.meta.dirname
      }/../fixtures/public-directories/hello-world`,
      errorHandler: '{error}.ts',
      handlerFilenameSuffix: '{page}.ts',
    })
    await server.listen(availablePort)

    try {
      const rootResponse = await fetch(`http://localhost:${availablePort}/`)
      assert.deepEqual(rootResponse.status, 200)
      assert.deepEqual(
        rootResponse.headers.get('content-type'),
        'text/html; charset=utf-8',
      )
      assert((await rootResponse.text()).startsWith('<!doctype html>'))

      const cssResponse = await fetch(
        `http://localhost:${availablePort}/style.css`,
      )
      assert.deepEqual(cssResponse.status, 200)
      assert.deepEqual(cssResponse.headers.get('content-type'), 'text/css')
      assert(cssResponse.headers.get('cache-control')?.startsWith('max-age='))
      assert((await cssResponse.text()).startsWith('html {'))

      const notFoundResponse = await fetch(
        `http://localhost:${availablePort}/this/path/does/not/exist`,
      )
      assert.deepEqual(notFoundResponse.status, 404)
      assert.deepEqual(
        notFoundResponse.headers.get('content-type'),
        'text/html; charset=utf-8',
      )
      assert((await notFoundResponse.text()).startsWith('<!doctype html>'))
    } finally {
      await server.close()
    }
  })

  test('request handling with custom handlers', async _ => {
    const availablePort = await getAvailablePort()

    const server = createServer({
      publicDirectory: `${
        import.meta.dirname
      }/../fixtures/public-directories/handlers`,
      errorHandler: '{error}.ts',
      handlerFilenameSuffix: '{page}.ts',
    })
    await server.listen(availablePort)

    try {
      const rootGetResponse = await fetch(`http://localhost:${availablePort}/`)
      assert.deepEqual(rootGetResponse.status, 418)
      assert.deepEqual(
        rootGetResponse.headers.get('custom-header'),
        'custom header value',
      )
      assert.deepEqual(
        await rootGetResponse.text(),
        'This text is from the GET handler',
      )

      const rootPostResponse = await fetch(
        `http://localhost:${availablePort}/`,
        { method: 'POST' },
      )
      assert.deepEqual(rootPostResponse.status, 418)
      assert.deepEqual(
        rootPostResponse.headers.get('custom-header'),
        'custom header value',
      )
      assert.deepEqual(
        await rootPostResponse.text(),
        'This text is from the POST handler',
      )

      const notFoundResponse = await fetch(
        `http://localhost:${availablePort}/this/path/does/not/exist`,
      )
      assert.deepEqual(notFoundResponse.status, 410)
      assert.deepEqual(
        notFoundResponse.headers.get('custom-header'),
        'custom header value',
      )
      assert.deepEqual(
        await notFoundResponse.text(),
        'This text is from the error handler',
      )
    } finally {
      await server.close()
    }
  })

  test('unsupported methods', async _ => {
    const availablePort = await getAvailablePort()
    const server = createServer({
      publicDirectory: `${
        import.meta.dirname
      }/../fixtures/public-directories/hello-world`,
      errorHandler: '{error}.ts',
      handlerFilenameSuffix: '{page}.ts',
    })
    await server.listen(availablePort)

    try {
      const rootResponse = await fetch(`http://localhost:${availablePort}/`, {
        method: 'OPTIONS',
      })
      assert.deepEqual(rootResponse.status, 501)
      assert.deepEqual(
        rootResponse.headers.get('content-type'),
        'text/html; charset=utf-8',
      )
      assert((await rootResponse.text()).startsWith('<!doctype html>'))
    } finally {
      await server.close()
    }
  })
})
