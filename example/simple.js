'use strict'
// **Github:** https://github.com/toajs/toa-net
//
// **License:** MIT

const net = require('..')

const auth = new net.Auth('secretxxx')
const server = new net.Server(function (socket) {
  console.log(socket.session) // { exp: 1463131669, id: 'example' }

  socket.on('message', (message) => {
    console.log(message)
    // { payload: { jsonrpc: '2.0', method: 'hello', params: [ 1 ] },
    //   type: 'notification' }
    // ...

    if (message.type === 'request') {
      // echo request
      socket.success(message.payload.id, message.payload.params)
    }
  })
}).listen(8000)

// Enable authentication for server
server.getAuthenticator = function () {
  return (signature) => auth.verify(signature)
}

const client = new net.Client()
// Enable authentication for client
client.getSignature = function () {
  return auth.sign({id: 'clientId'})
}
client.connect(8000)

client.notification('hello', [1])
client.notification('hello', [2])
client.notification('hello', [3])
client.request('echo', {a: 4})((err, res) => {
  console.log(err, res) // null { a: 4 }

  client.destroy()
  server.close()
})
