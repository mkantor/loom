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

let availablePort: number | undefined = undefined
let remainingAttempts = 10 // Try up to this many ports before giving up.
while (remainingAttempts > 0) {
  remainingAttempts = remainingAttempts - 1
  const arbitraryPort = getArbitraryPort()
  const portIsTaken = await isPortTaken(arbitraryPort)
  if (!portIsTaken) {
    availablePort = arbitraryPort
    break
  }
}
if (availablePort === undefined) {
  throw new Error('Could not find an available port')
}

suite('server', _ => {
  test('lifecycle', async _ => {
    const server = createServer({
      publicDirectory: '/dev/null',
      errorPage: 'error.js',
      pageFilenameSuffix: '__page.js',
    })
    assert.deepEqual(await server.listen(availablePort), undefined)
    assert.deepEqual(await server.close(), undefined)
  })

  test('configuration defaults', async _ => {
    const server = createServer({
      publicDirectory: '/dev/null',
    })
    assert.deepEqual(await server.listen(availablePort), undefined)
    assert.deepEqual(await server.close(), undefined)
  })
})
