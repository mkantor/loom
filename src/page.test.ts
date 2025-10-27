import { createElement } from '@superhighway/silk'
import assert from 'node:assert'
import test, { suite } from 'node:test'
import { page } from './page.js'

const testURL = 'https://example.com/'
const testPage = page(request => createElement('div', {}, request.url))

suite('page', _ => {
  test('response', async _ => {
    const response = testPage(new Request(testURL), {
      status: 200,
      headers: {},
    })

    const responseBody = await (await response).text()
    assert.deepEqual(responseBody, `<!doctype html><div>${testURL}</div>`)
  })
})
