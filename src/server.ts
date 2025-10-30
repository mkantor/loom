import mime from 'mime/lite'
import nodeFS from 'node:fs/promises'
import * as nodeHTTP from 'node:http'
import nodePath from 'node:path'
import {
  isRequestHandlerModule,
  type SuggestedResponseDetails,
} from './handler.js'
import {
  incomingMessageToWebRequest,
  writeWebResponseToServerResponse,
} from './nodeHTTPAdapters.js'

export type ServerConfiguration = {
  /**
   * The path where your request handlers and static content lives. The root of
   * this directory corresponds to the routing root.
   */
  readonly publicDirectory: string

  /**
   * A path relative to `publicDirectory` where an error handler may be found.
   * If a request handler module is not found at this path, minimal `text/plain`
   * responses will be sent upon errors.
   *
   * Defaults to `'#error.js'`.
   */
  readonly errorHandler?: string

  /**
   * Defaults to `'#handler.js'`.
   */
  readonly handlerFilenameSuffix?: string
}

const serverConfigurationDefaults = {
  handlerFilenameSuffix: '#handler.js',
  errorHandler: '#error.js',
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
    handleRequest(request).then(response => {
      console.info(
        `Responding with HTTP ${response.status} to \`${request.method} ${request.url}\``,
      )
      return writeWebResponseToServerResponse(response, serverResponse)
    })
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

const createRequestHandler =
  (configuration: ServerConfiguration) =>
  async (request: Request): Promise<Response> => {
    const configurationWithDefaults = {
      ...serverConfigurationDefaults,
      ...configuration,
    }

    if (!methodIsRoutable(request.method)) {
      return handleError(
        request,
        { status: 501, headers: {} },
        configurationWithDefaults,
      )
    }

    // Percent-decode and normalize to a relative path without a trailing `/`.
    const requestPath = decodeURI(new URL(request.url).pathname).replace(
      /^\/+|\/+$/g,
      '',
    )

    // First try looking for a handler to serve the request.
    return handleRequestDynamicallyOrReject(
      requestPath,
      request,
      {
        status: 200,
        headers: {},
      },
      configurationWithDefaults,
    ).catch(async (handlerError: unknown) => {
      console.error(
        `Could not handle \`${request.method} ${request.url}\` dynamically:`,
        handlerError instanceof Error ? handlerError.toString() : handlerError,
      )
      console.warn('Falling back to a static file (if one exists)')
      return handleRequestForStaticFile(
        requestPath,
        request,
        configurationWithDefaults,
      )
    })
  }

const handleRequestDynamicallyOrReject = (
  requestPath: string,
  request: Request,
  responseDetails: SuggestedResponseDetails,
  configuration: Required<ServerConfiguration>,
) => {
  const handlerModulePath = getHandlerModulePath(configuration, {
    method: request.method,
    requestPath,
  })
  return import(handlerModulePath).then(async (module: unknown) => {
    if (!isRequestHandlerModule(module)) {
      throw new Error(
        `'${handlerModulePath}' is not a valid request handler module`,
      )
    } else {
      return module.default(request, responseDetails)
    }
  })
}

const handleRequestForStaticFile = async (
  requestPath: string,
  request: Request,
  configuration: Required<ServerConfiguration>,
) => {
  // Make it impossible to get the source of a handler this way (something
  // else would have had to already gone wrong to make it here; this is
  // defense in depth).
  if (requestPath.endsWith(configuration.handlerFilenameSuffix)) {
    console.error(
      `Request path '/${requestPath}' ends in '${configuration.handlerFilenameSuffix}'`,
    )
    return handleError(request, { status: 404, headers: {} }, configuration)
  } else if (requestPath === configuration.errorHandler) {
    console.error(`Request path '/${requestPath}' was for error handler`)
    return handleError(request, { status: 404, headers: {} }, configuration)
  } else {
    // Try to serve as a static file.
    let staticFilePath = getStaticFilePath(configuration, {
      method: request.method,
      requestPath,
    })
    try {
      // Resolve symlinks. Mime types are based on the resolved path.
      staticFilePath = await nodeFS.readlink(staticFilePath)
      if (!nodePath.isAbsolute(staticFilePath)) {
        staticFilePath = `${configuration.publicDirectory}/${staticFilePath}`
      }
    } catch {
      // Errors here indicate the file was not a symlink, which is fine.
    }
    const mimeType = mime.getType(staticFilePath)

    let staticFile: nodeFS.FileHandle | undefined
    try {
      staticFile = await nodeFS.open(staticFilePath)
      await staticFile.stat().then(stats => {
        if (stats.isFile() === false) {
          throw new Error(`'${staticFilePath}' is not a file`)
        }
      })
      const oneYearInSeconds = '31536000'

      if (request.method === 'HEAD') {
        await staticFile.close()
        return new Response(undefined, {
          status: 200,
          headers: {
            'cache-control': `max-age=${oneYearInSeconds}`,
            ...(mimeType ? { 'content-type': mimeType } : {}),
          },
        })
      }

      // When the `ReadableStream` methods below capture `staticFile`, it's
      // typed as `nodeFS.FileHandle | undefined` even though it is definitely
      // defined. This narrowly-typed alias avoids the need to handle an
      // impossible `undefined` case.
      const definedStaticFile: nodeFS.FileHandle = staticFile

      const fileStream = staticFile.readableWebStream()

      // Close `staticFile` after the response stream finishes or is canceled.
      const fileHandleClosingStream = new ReadableStream({
        start: async controller => {
          const reader = fileStream.getReader()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                controller.close()
                break
              }
              controller.enqueue(value)
            }
          } catch (error) {
            controller.error(error)
          } finally {
            await definedStaticFile.close()
          }
        },
        cancel: async reason => {
          await fileStream.cancel(reason)
          await definedStaticFile.close()
        },
      })

      return new Response(fileHandleClosingStream, {
        status: 200,
        headers: {
          'cache-control': `max-age=${oneYearInSeconds}`,
          ...(mimeType ? { 'content-type': mimeType } : {}),
        },
      })
    } catch (error) {
      console.error(
        `Could not handle \`${request.method} ${request.url}\` as a static file:`,
        error instanceof Error ? error.toString() : error,
      )
      await staticFile?.close()

      // These will be lowercase.
      const allowedMethods: readonly string[] = (
        await Promise.all(
          Array.from(lowercasedRoutableMethods).map(method =>
            // Check if there is a handler or static file for this method at
            // the requested path.
            nodeFS
              .stat(
                getHandlerModulePath(configuration, {
                  method,
                  requestPath,
                }),
              )
              .then(_ => method)
              .catch(_ =>
                nodeFS
                  .stat(
                    getStaticFilePath(configuration, {
                      method,
                      requestPath,
                    }),
                  )
                  .then(_ => method)
                  .catch(_ => undefined),
              ),
          ),
        )
      ).filter(method => method !== undefined)

      if (allowedMethods.length > 0) {
        return handleError(
          request,
          {
            status: 405,
            headers: {
              allow: allowedMethods
                .map(method => method.toUpperCase())
                .join(', '),
            },
          },
          configuration,
        )
      } else {
        return handleError(request, { status: 404, headers: {} }, configuration)
      }
    }
  }
}

const handleError = (
  originalRequest: Request,
  responseDetails: Exclude<SuggestedResponseDetails, { readonly status: 200 }>,
  configuration: Required<ServerConfiguration>,
) => {
  const errorModulePath = getErrorModulePath(configuration)
  return import(errorModulePath)
    .then(async (module: unknown) => {
      if (!isRequestHandlerModule(module)) {
        throw new Error(
          `'${errorModulePath}' is not a valid request handler module`,
        )
      } else {
        return module.default(originalRequest, responseDetails)
      }
    })
    .catch(_error => {
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
        headers: { ...responseDetails.headers, 'content-type': 'text/plain' },
      })
    })
}

const getHandlerModulePath = (
  configuration: Required<ServerConfiguration>,
  requestDetails: {
    readonly method: string
    readonly requestPath: string
  },
) => {
  const lowercaseMethod = requestDetails.method.toLowerCase()
  const methodAsPathComponent =
    lowercaseMethod === 'head' ? 'get' : lowercaseMethod

  return `${configuration.publicDirectory}/${methodAsPathComponent}/${
    requestDetails.requestPath
  }${encodeURIComponent(configuration.handlerFilenameSuffix)}`
}

const getStaticFilePath = (
  configuration: Required<ServerConfiguration>,
  requestDetails: {
    readonly method: string
    readonly requestPath: string
  },
) => {
  const lowercaseMethod = requestDetails.method.toLowerCase()
  const methodAsPathComponent =
    lowercaseMethod === 'head' ? 'get' : lowercaseMethod

  return `${configuration.publicDirectory}/${methodAsPathComponent}/${requestDetails.requestPath}`
}

const getErrorModulePath = (configuration: Required<ServerConfiguration>) =>
  `${configuration.publicDirectory}/${encodeURIComponent(
    configuration.errorHandler,
  )}`

const lowercasedRoutableMethods = new Set([
  'delete',
  'get',
  'patch',
  'post',
  'put',
  'head',
])

const methodIsRoutable = (method: string): boolean =>
  lowercasedRoutableMethods.has(method.toLowerCase())
