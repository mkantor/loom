export type RequestHandler = {
  readonly [isHandler]: true
} & RequestHandlerFunction
export const requestHandler = (
  handlerFunction: RequestHandlerFunction,
): RequestHandler => {
  if (isHandler in handlerFunction && handlerFunction[isHandler] !== true) {
    // This ought to be impossible (`isHandler` is not exported).
    throw new Error(
      'Handler already has an `isHandler` symbol property whose value is not `true`. This is a bug!',
    )
  }
  const requestHandlerLike: { [isHandler]?: true } & RequestHandlerFunction =
    handlerFunction
  requestHandlerLike[isHandler] = true
  return requestHandlerLike as RequestHandler
}

export const isRequestHandlerModule = (
  module: unknown,
): module is { readonly default: RequestHandler } =>
  typeof module === 'object' &&
  module !== null &&
  'default' in module &&
  typeof module.default === 'function' &&
  isHandler in module.default &&
  module.default[isHandler] === true

// The server only ever responds with a subset of the possible status codes.
export type SuggestedResponseDetails =
  | {
      readonly status: 200 // OK
      readonly headers: {}
    }
  | {
      readonly status: 400 // Bad Request
      readonly headers: {}
    }
  | {
      readonly status: 404 // Not Found
      readonly headers: {}
    }
  | {
      readonly status: 405 // Method Not Allowed
      readonly headers: {
        readonly allow: string
      }
    }
  | {
      readonly status: 406 // Not Acceptable
      readonly headers: {}
    }
  | {
      readonly status: 500 // Internal Server Error
      readonly headers: {}
    }
  | {
      readonly status: 501 // Not Implemented
      readonly headers: {}
    }

export type ResponseStatus = SuggestedResponseDetails['status']

const isHandler = Symbol('isHandler')

type RequestHandlerFunction = (
  request: Request,
  responseDetails: SuggestedResponseDetails,
) => Response | Promise<Response>
