import mime from 'mime/lite'
import nodeFS from 'node:fs/promises'
import * as nodeHTTP from 'node:http'
import nodePath from 'node:path'
import { Readable, Writable } from 'node:stream'
import { isRequestHandlerModule, type ResponseStatus } from './handler.js'

export type ServerConfiguration = {
  /**
   * The path where your pages and other content live. The root of this
   * directory corresponds to the routing root.
   */
  readonly publicDirectory: string

  /**
   * A path relative to `publicDirectory` where an error handler may be found.
   * If a request handler module is not found at this path, minimal `text/plain`
   * responses will be sent upon errors.
   *
   * Defaults to `'{error}.js'`.
   */
  readonly errorHandler?: string

  /**
   * Defaults to `'{page}.js'`.
   */
  readonly handlerFilenameSuffix?: string
}
const serverConfigurationDefaults = {
  errorHandler: '{error}.js',
  handlerFilenameSuffix: '{page}.js',
} satisfies Partial<ServerConfiguration>

export type Server = {
  /**
   * Start an HTTP server listening for TCP connections on the given `port`.
   *
   * The returned `Promise` resolves when the server starts listening for
   * connections. This `Promise` may reject, e.g. if the specified `port` is
   * already in use.
   */
  readonly listen: (port: number) => Promise<undefined>

  /**
   * Stops the server from accepting new connections and keeps existing
   * connections.
   *
   * The returned `Promise` resolves when all existing connections have ended.
   * This `Promise` may reject, e.g. if the server was not listening.
   */
  readonly close: () => Promise<undefined>
}

export const createServer = (configuration: ServerConfiguration): Server => {
  const handleRequest = createRequestHandler(configuration)
  const server = nodeHTTP.createServer((incomingMessage, serverResponse) => {
    const request = incomingMessageToWebRequest(
      incomingMessage,
      `http://${process.env['HOST'] ?? 'localhost'}`,
    )
    handleRequest(request).then(response =>
      writeWebResponseToServerResponse(response, serverResponse),
    )
  })

  return {
    listen: port =>
      new Promise(resolve => server.listen({ port }, () => resolve(undefined))),
    close: () =>
      new Promise((resolve, reject) =>
        server.close(err =>
          err === undefined ? resolve(undefined) : reject(err),
        ),
      ),
  }
}

const routableMethods = new Set(['delete', 'get', 'patch', 'post', 'put'])
const methodIsRoutable = (method: string): boolean =>
  routableMethods.has(method.toLowerCase())

const createRequestHandler =
  (configuration: ServerConfiguration) =>
  async (request: Request): Promise<Response> => {
    const { publicDirectory, handlerFilenameSuffix, errorHandler } = {
      ...serverConfigurationDefaults,
      ...configuration,
    }

    const errorModulePath = `${publicDirectory}/${errorHandler}`

    if (!methodIsRoutable(request.method)) {
      return handleError(errorModulePath, request, { status: 501 })
    }

    // Percent-decode and normalize to a relative path without a trailing `/`.
    const requestPath = decodeURI(new URL(request.url).pathname).replace(
      /^\/+|\/+$/g,
      '',
    )

    // First try looking for a handler to serve the request.
    const handlerModulePath = `${publicDirectory}/${request.method.toLowerCase()}/${requestPath}${encodeURIComponent(
      handlerFilenameSuffix,
    )}`
    return handleRequestDynamicallyOrReject(handlerModulePath, request, {
      status: 200,
    }).catch(async (handlerError: unknown) => {
      // Fall back to looking for a static file.

      if (
        // Don't log `ERR_MODULE_NOT_FOUND` errors (they're expected if the
        // request is for a static file rather than a dynamic handler).
        typeof handlerError !== 'object' ||
        handlerError === null ||
        !('code' in handlerError) ||
        handlerError.code !== 'ERR_MODULE_NOT_FOUND'
      ) {
        console.error(handlerError)
        console.warn('Falling back to a static file (if one exists)')
      }

      // Make it impossible to get the source of a handler this way (something
      // else would have had to already gone wrong to make it here; this is
      // defense in depth).
      if (requestPath.endsWith(handlerFilenameSuffix)) {
        console.error(
          `Request path '/${requestPath}' ends in '${handlerFilenameSuffix}'`,
        )
        return handleError(errorModulePath, request, { status: 404 })
      } else if (requestPath === errorHandler) {
        console.error(`Request path '/${requestPath}' was for error handler`)
        return handleError(errorModulePath, request, { status: 404 })
      } else {
        // Try to serve as a static file.
        let path = `${publicDirectory}/${request.method.toLowerCase()}/${requestPath}`
        try {
          // Resolve symlinks. Mime types are based on the resolved path.
          path = await nodeFS.readlink(path)
          if (!nodePath.isAbsolute(path)) {
            path = `${publicDirectory}/${path}`
          }
        } catch {
          // Errors here indicate the file was not a symlink, which is fine.
        }
        const mimeType = mime.getType(path)

        let staticFile
        try {
          staticFile = await nodeFS.open(path)
          await staticFile.stat().then(stats => {
            if (stats.isFile() === false) {
              throw new Error(`'${path}' is not a file`)
            }
          })
          const oneYearInSeconds = '31536000'
          return new Response(
            staticFile.readableWebStream({ autoClose: true }),
            {
              status: 200,
              headers: {
                'cache-control': `max-age=${oneYearInSeconds}`,
                ...(mimeType ? { 'content-type': mimeType } : {}),
              },
            },
          )
        } catch (error) {
          console.error(error)
          if (staticFile !== undefined) {
            staticFile.close()
          }
          return handleError(errorModulePath, request, { status: 404 })
        }
      }
    })
  }

const handleRequestDynamicallyOrReject = (
  modulePath: string,
  request: Request,
  responseDetails: { readonly status: ResponseStatus },
) =>
  import(modulePath).then(async (module: unknown) => {
    if (!isRequestHandlerModule(module)) {
      throw new Error(`'${modulePath}' is not a valid request handler module`)
    } else {
      return module.default(request, responseDetails)
    }
  })

const handleError = (
  errorModulePath: string,
  originalRequest: Request,
  responseDetails: { readonly status: Exclude<ResponseStatus, 200> },
) =>
  handleRequestDynamicallyOrReject(
    errorModulePath,
    originalRequest,
    responseDetails,
  ).catch(_error => {
    // Fall back to a `text/plain` error if the error handler itself failed
    // (or does not exist).
    const errorMessage = ((): string => {
      switch (responseDetails.status) {
        case 400:
          return 'Bad Request'
        case 404:
          return 'Not Found'
        case 405:
          return 'Method Not Allowed'
        case 406:
          return 'Not Acceptable'
        case 500:
          return 'Internal Server Error'
        case 501:
          return 'Not Implemented'
      }
    })()
    return new Response(errorMessage, {
      status: responseDetails.status,
      headers: { 'content-type': 'text/plain' },
    })
  })

/**
 * Expects an `incomingMessage` obtained from a `Server` (it must have its
 * `.url` set).
 */
const incomingMessageToWebRequest = (
  incomingMessage: nodeHTTP.IncomingMessage,
  baseUrl: string,
): Request => {
  const url = new URL(incomingMessage.url ?? '/', baseUrl)

  const headers = new Headers()
  for (const key in incomingMessage.headers) {
    const value = incomingMessage.headers[key]
    if (value !== undefined) {
      if (Array.isArray(value)) {
        value.forEach(element => headers.append(key, element))
      } else {
        headers.append(key, value)
      }
    }
  }

  const body =
    incomingMessage.method !== 'GET' && incomingMessage.method !== 'HEAD'
      ? Readable.toWeb(incomingMessage)
      : null

  const request = new Request(url.toString(), {
    method: incomingMessage.method ?? '', // This fallback is expected to fail.
    headers,
    body,
    duplex: 'half',
  })

  return request
}

const writeWebResponseToServerResponse = async (
  webResponse: Response,
  serverResponse: nodeHTTP.ServerResponse,
): Promise<undefined> => {
  serverResponse.statusCode = webResponse.status
  serverResponse.statusMessage = webResponse.statusText
  serverResponse.setHeaders(webResponse.headers)
  try {
    await webResponse.body
      ?.pipeTo(Writable.toWeb(serverResponse))
      .catch(console.error)
  } finally {
    await new Promise(resolve => serverResponse.end(resolve))
  }
}
