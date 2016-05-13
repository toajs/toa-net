'use strict'
// **Github:** https://github.com/toajs/toa-net
//
// **License:** MIT

const thunk = require('thunks')()
const net = require('..')

const server = new net.Server(function (socket) {
  thunk(function * () {
    for (let value of socket) {
      let message = yield value
      console.log(message)
      // { payload: { jsonrpc: '2.0', method: 'hello', params: [ 1 ] },
      //   type: 'notification' }
      // ...

      if (message.type === 'request') {
        // respond to the request
        socket.success(message.payload.id, message.payload.params)
      }
    }
  })(() => process.exit(0))
}).listen(8000)

const client = new net.Client().connect(8000)

client.notification('hello', [1])
client.notification('hello', [2])
client.notification('hello', [3])
client.request('echo', {a: 4})((err, res) => {
  console.log(err, res) // null { a: 4 }

  client.destroy()
  server.close()
})
