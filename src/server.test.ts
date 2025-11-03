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
      errorHandler: '#error.ts',
      handlerFilenameSuffix: '#handler.ts',
    })
    await server.listen(availablePort)

    try {
      const getRootResponse = await fetch(`http://localhost:${availablePort}/`)
      assert.deepEqual(getRootResponse.status, 200)
      assert.deepEqual(
        getRootResponse.headers.get('content-type'),
        'text/html; charset=utf-8',
      )
      assert((await getRootResponse.text()).startsWith('<!doctype html>'))

      const headRootResponse = await fetch(
        `http://localhost:${availablePort}/`,
        { method: 'HEAD' },
      )
      assert.deepEqual(headRootResponse.status, 200)
      assert.deepEqual(
        headRootResponse.headers.get('content-type'),
        'text/html; charset=utf-8',
      )
      assert.deepEqual(headRootResponse.body, null)

      const getCSSResponse = await fetch(
        `http://localhost:${availablePort}/style.css`,
      )
      assert.deepEqual(getCSSResponse.status, 200)
      assert.deepEqual(getCSSResponse.headers.get('content-type'), 'text/css')
      assert(
        getCSSResponse.headers.get('cache-control')?.startsWith('max-age='),
      )
      assert((await getCSSResponse.text()).startsWith('html {'))

      const headCSSResponse = await fetch(
        `http://localhost:${availablePort}/style.css`,
        { method: 'HEAD' },
      )
      assert.deepEqual(headCSSResponse.status, 200)
      assert.deepEqual(headCSSResponse.headers.get('content-type'), 'text/css')
      assert(
        headCSSResponse.headers.get('cache-control')?.startsWith('max-age='),
      )
      assert.deepEqual(headCSSResponse.body, null)

      const notFoundResponse = await fetch(
        `http://localhost:${availablePort}/this/path/does/not/exist`,
      )
      assert.deepEqual(notFoundResponse.status, 404)
      assert.deepEqual(
        notFoundResponse.headers.get('content-type'),
        'text/html; charset=utf-8',
      )
      const responseBody = await notFoundResponse.text()
      assert(responseBody.startsWith('<!doctype html>'))
      assert(responseBody.includes('404'))
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
      errorHandler: '#error.ts',
      handlerFilenameSuffix: '#handler.ts',
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
      errorHandler: '#error.ts',
      handlerFilenameSuffix: '#handler.ts',
    })
    await server.listen(availablePort)

    try {
      const rootOptionsResponse = await fetch(
        `http://localhost:${availablePort}/`,
        {
          method: 'OPTIONS',
        },
      )
      assert.deepEqual(rootOptionsResponse.status, 501)
      assert.deepEqual(
        rootOptionsResponse.headers.get('content-type'),
        'text/html; charset=utf-8',
      )
      assert((await rootOptionsResponse.text()).startsWith('<!doctype html>'))

      const rootDeleteResponse = await fetch(
        `http://localhost:${availablePort}/`,
        {
          method: 'DELETE',
        },
      )
      assert.deepEqual(rootDeleteResponse.status, 405)
      assert.deepEqual(
        rootDeleteResponse.headers.get('content-type'),
        'text/html; charset=utf-8',
      )
      const allowedMethods = rootDeleteResponse.headers
        .get('allow')
        ?.split(', ')
      assert(allowedMethods?.includes('GET'))
      assert(allowedMethods?.includes('HEAD'))
      const responseBody = await rootDeleteResponse.text()
      assert(responseBody.startsWith('<!doctype html>'))
      assert(responseBody.includes('405'))
    } finally {
      await server.close()
    }
  })
})
