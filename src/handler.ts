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
export type ResponseStatus =
  | 200 // OK
  | 400 // Bad Request
  | 404 // Not Found
  | 405 // Method Not Allowed
  | 406 // Not Acceptable
  | 500 // Internal Server Error
  | 501 // Not Implemented

const isHandler = Symbol('isHandler')

type ResponseDetails = { readonly status: ResponseStatus }
type RequestHandlerFunction = (
  request: Request,
  responseDetails: ResponseDetails,
) => Response | Promise<Response>
