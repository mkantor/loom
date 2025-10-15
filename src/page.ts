import type { ReadableHTMLTokenStream } from '@superhighway/silk'
import type { ResponseStatus } from './server.js'

export type Page = { readonly [isPage]: true } & PageFunction
export const page = (handler: PageFunction): Page => {
  if (isPage in handler && handler[isPage] !== true) {
    // This ought to be impossible (`isPage` is not exported).
    throw new Error(
      'Page handler already has an `isPage` symbol property whose value is not `true`. This is a bug!',
    )
  }
  const handlerAsPageLike: { [isPage]?: true } & PageFunction = handler
  handlerAsPageLike[isPage] = true
  return handlerAsPageLike as Page
}

export const isPageModule = (
  module: unknown,
): module is { readonly default: Page } =>
  typeof module === 'object' &&
  module !== null &&
  'default' in module &&
  typeof module.default === 'function' &&
  isPage in module.default &&
  module.default[isPage] === true

const isPage = Symbol('isPage')

type ResponseDetails = { readonly status: ResponseStatus }
type PageFunction = (
  request: Request,
  responseDetails: ResponseDetails,
) => ReadableHTMLTokenStream
