import {
  HTMLSerializingTransformStream,
  type ReadableHTMLTokenStream,
} from '@superhighway/silk'
import { requestHandler, type RequestHandler } from './handler.js'

export const page = (pageFunction: PageFunction): RequestHandler =>
  requestHandler(
    (request, responseDetails) =>
      new Response(
        pageFunction(request)
          .pipeThrough(
            new HTMLSerializingTransformStream({
              includeDoctype: true,
            }),
          )
          .pipeThrough(new TextEncoderStream()),
        {
          status: responseDetails.status,
          headers: {
            ...responseDetails.headers,
            'content-type': 'text/html; charset=utf-8',
          },
        },
      ),
  )

type PageFunction = (request: Request) => ReadableHTMLTokenStream
