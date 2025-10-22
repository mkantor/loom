import { createElement } from '@superhighway/silk'
import { page } from '../../../dist-test/page.js'

export default page((request, { status }) =>
  createElement(
    'html',
    { lang: 'en' },
    createElement(
      'head',
      null,
      createElement('title', null, 'Error'),
      createElement('link', { rel: 'stylesheet', href: 'style.css' }),
    ),
    createElement('body', null, 'Something went wrong.'),
  ),
)
