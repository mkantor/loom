import { createElement } from '@superhighway/silk'
import { page } from '../../../../dist-test/page.js'

export default page(request =>
  createElement(
    'html',
    { lang: 'en' },
    createElement(
      'head',
      null,
      createElement('title', null, 'Greeting'),
      createElement('link', { rel: 'stylesheet', href: 'style.css' }),
    ),
    createElement('body', null, 'Hello, world!'),
  ),
)
