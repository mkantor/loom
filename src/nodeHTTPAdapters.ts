import { IncomingMessage, ServerResponse } from 'node:http'
import { Readable, Writable } from 'node:stream'

/**
 * Expects an `incomingMessage` obtained from a `Server` (it must have its
 * `.url` set).
 */
export const incomingMessageToWebRequest = (
  incomingMessage: IncomingMessage,
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

export const writeWebResponseToServerResponse = async (
  webResponse: Response,
  serverResponse: ServerResponse,
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
