import { createElement } from '@matt.kantor/silk/dist/createElement.js'
import type { HTMLToken } from '@matt.kantor/silk/dist/htmlToken.js'
import assert from 'node:assert'
import test, { suite } from 'node:test'
import { isPageModule, page } from './page.js'

const testURL = 'https://example.com/'
const testPage = page(request => createElement('div', {}, request.url))

suite('page', _ => {
  test('response', async _ => {
    const response = testPage(new Request(testURL), {
      status: 200,
    })

    const tokens: HTMLToken[] = []
    for await (const token of response) {
      tokens.push(token)
    }

    assert.deepEqual(tokens, [
      {
        kind: 'startOfOpeningTag',
        tagName: 'div',
      },
      {
        kind: 'endOfOpeningTag',
      },
      {
        kind: 'text',
        text: testURL,
      },
      {
        kind: 'closingTag',
      },
    ])
  })

  test('isPage', async _ => {
    assert(isPageModule({ default: testPage }))
    assert(!isPageModule({}))
    assert(!isPageModule({ default: 'not a page' }))
    assert(!isPageModule({ default: () => {} }))
  })
})
