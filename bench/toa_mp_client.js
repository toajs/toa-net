'use strict'

const ilog = require('ilog')
const net = require('..')
const thunk = require('thunks')()
const Msgp = require('msgp')
const jsonrpc = require('jsonrpc-lite')
const auth = new net.Auth('secretxxx')
const client = new net.Client()
const msgpack = require('msgpack5')()

// Use MessagePack instead of JSON
// http://msgpack.org/
net.RPCCommand.prototype._encodeMsg = function (jsonRpcObj) {
  return msgpack.encode(jsonRpcObj)
}

net.Socket.prototype._initBufParser = function (socket) {
  socket.parser = new Msgp()
  socket.pipe(socket.parser)
  return socket.parser
}

net.Socket.prototype._encodeBuf = function (bufOrStr) {
  return Msgp.encode(bufOrStr)
}

net.Socket.prototype._encodeMsg = function (jsonRpcObj) {
  return msgpack.encode(jsonRpcObj)
}

net.Socket.prototype._decodeMsg = function (data) {
  return jsonrpc.parseObject(msgpack.decode(data))
}

client.getSignature = function () {
  return auth.sign({id: 'test'})
}
client.connect(3001, '127.0.0.1')

thunk(function * () {
  yield (done) => client.once('auth', done.bind(null, null))
  ilog.info(`Connected to [${client.socket.remoteAddress}]:${client.socket.remotePort}`)

  let total = 5000000
  let count = total
  let finish = 0
  let queue = []
  let cocurrency = 1000
  let time = Date.now()

  while (count--) {
    queue.push(client.request('ping')((_, res) => {
      if (!(finish++ % 10000)) process.stdout.write('.')
    }))
    if (queue.length >= cocurrency) yield queue.shift()
  }
  // wait for all request.
  yield queue
  time = Date.now() - time
  ilog('\nFinished,', cocurrency + ' cocurrency,', time + ' ms,',
    (client.socket.bytesWritten / 1000).toFixed(2) + ' kb',
    (total / (time / 1000)).toFixed(2) + ' ops')

  client.destroy()
})(ilog.error)
