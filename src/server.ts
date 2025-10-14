import { HTMLSerializingTransformStream } from '@matt.kantor/silk'
import mime from 'mime/lite'
import nodeFS from 'node:fs/promises'
import * as nodeHTTP from 'node:http'
import nodePath from 'node:path'
import { Readable, Writable } from 'node:stream'
import { isPageModule } from './page.js'

export type ServerConfiguration = {
  /**
   * The path where your pages and other content live. The root of this
   * directory corresponds to the routing root.
   */
  readonly publicDirectory: string

  /**
   * A path relative to `contentDirectory` where an error page may be found. If
   * a page is not found at this path, minimal `text/plain` responses will be
   * sent upon errors.
   *
   * Defaults to `{error}.js`.
   */
  readonly errorPage?: string

  /**
   * Defaults to `'{page}.js'`.
   */
  readonly pageFilenameSuffix?: string
}
const serverConfigurationDefaults = {
  pageFilenameSuffix: '{page}.js',
  errorPage: '{error}.js',
}

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

// The server only ever responds with a subset of the possible status codes.
export type ResponseStatus = 200 | 404 | 500

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

const createRequestHandler =
  (configuration: ServerConfiguration) =>
  async (request: Request): Promise<Response> => {
    // Percent-decode and normalize to a relative path without a trailing `/`.
    const requestPath = decodeURI(new URL(request.url).pathname).replace(
      /^\/+|\/+$/g,
      '',
    )

    const { publicDirectory, pageFilenameSuffix, errorPage } = {
      ...serverConfigurationDefaults,
      ...configuration,
    }

    const errorPageModulePath = `${publicDirectory}/${errorPage}`

    // First try looking for a page to serve the request.
    const pageModulePath = `${publicDirectory}/${requestPath}${pageFilenameSuffix}`
    return handlePageRequestOrReject(pageModulePath, request, {
      status: 200,
    }).catch(async (pageError: unknown) => {
      // Fall back to looking for a static file.

      if (
        // Don't log `ERR_MODULE_NOT_FOUND` errors (they're expected if the
        // request is for a static file rather than a page).
        typeof pageError !== 'object' ||
        pageError === null ||
        !('code' in pageError) ||
        pageError.code !== 'ERR_MODULE_NOT_FOUND'
      ) {
        console.error(pageError)
        console.warn('Falling back to a static file (if one exists)')
      }

      // Make it impossible to get the source of a page this way (something else
      // would have had to already gone wrong to make it here; this is defense
      // in depth).
      if (requestPath.endsWith(pageFilenameSuffix)) {
        console.error(
          `Request path '/${requestPath}' ends in '${pageFilenameSuffix}'`,
        )
        return handleError(errorPageModulePath, request, { status: 404 })
      } else if (requestPath === errorPage) {
        console.error(`Request path '/${requestPath}' was for error page`)
        return handleError(errorPageModulePath, request, { status: 404 })
      } else {
        // Try to serve as a static file.
        let path = `${publicDirectory}/${requestPath}`
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
          return new Response(
            staticFile.readableWebStream({ autoClose: true }),
            {
              status: 200,
              headers: mimeType ? { 'content-type': mimeType } : {},
            },
          )
        } catch (error) {
          console.error(error)
          if (staticFile !== undefined) {
            staticFile.close()
          }
          return handleError(errorPageModulePath, request, { status: 404 })
        }
      }
    })
  }

const handlePageRequestOrReject = (
  pageModulePath: string,
  request: Request,
  responseDetails: { readonly status: ResponseStatus },
) =>
  import(pageModulePath).then((module: unknown) => {
    if (!isPageModule(module)) {
      throw new Error(`'${pageModulePath}' is not a valid page module`)
    } else {
      const page = module.default(request, responseDetails)
      return new Response(
        page
          .pipeThrough(
            new HTMLSerializingTransformStream({
              includeDoctype: true,
            }),
          )
          .pipeThrough(new TextEncoderStream()),
        {
          status: responseDetails.status,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      )
    }
  })

const handleError = (
  errorPageModulePath: string,
  originalRequest: Request,
  responseDetails: { readonly status: Exclude<ResponseStatus, 200> },
) =>
  handlePageRequestOrReject(
    errorPageModulePath,
    originalRequest,
    responseDetails,
  ).catch(_error => {
    // Fall back to a `text/plain` error if the error handler itself failed
    // (or does not exist).
    const errorMessage = ((): string => {
      switch (responseDetails.status) {
        case 404:
          return 'Not Found'
        case 500:
          return 'Internal Server Error'
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
