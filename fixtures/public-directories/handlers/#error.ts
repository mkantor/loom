import { requestHandler } from '../../../dist-test/handler.js'

export default requestHandler(
  request =>
    new Response('This text is from the error handler', {
      status: 410,
      headers: { 'custom-header': 'custom header value' },
    }),
)
