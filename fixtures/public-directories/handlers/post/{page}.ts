import { requestHandler } from '../../../../dist-test/handler.js'

export default requestHandler(
  request =>
    new Response('This text is from the POST handler', {
      status: 418,
      headers: { 'custom-header': 'custom header value' },
    }),
)
