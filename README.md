# loom

Loom is a simple web server for Node.js. Web pages in Loom use [Silk][silk] for
server-side rendering.

Loom has filesystem-based routing: when you start the server you provide a
directory containing static files and dynamic request handlers which are used to
serve incoming HTTP requests.

The server avoids buffering response data as much as possible, instead streaming
it to the client as soon as it becomes available.

Example websites powered by Loom & Silk are available in this repository:
<https://github.com/mkantor/silk-demos>.

## Quick Start

This creates a basic "hello world" website:

```sh
npm create loom@latest $path
cd $path
PORT=9999 npm run start
```

There should now be web server running at http://localhost:9999.

[silk]: https://github.com/mkantor/silk
