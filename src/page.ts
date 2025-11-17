import type { ReadableHTMLStream } from '@superhighway/silk'
import {
  requestHandler,
  type RequestHandler,
  type SuggestedResponseDetails,
} from './handler.js'

export const page = (pageFunction: PageFunction): RequestHandler =>
  requestHandler(
    (request, responseDetails) =>
      new Response(
        request.method === 'HEAD'
          ? undefined
          : pageFunction(request, responseDetails).asBytes({
              includeDoctype: true,
            }),
        {
          status: responseDetails.status,
          headers: {
            ...responseDetails.headers,
            'content-type': 'text/html; charset=utf-8',
          },
        },
      ),
  )

type PageFunction = (
  request: Request,
  responseDetails: SuggestedResponseDetails,
) => ReadableHTMLStream
