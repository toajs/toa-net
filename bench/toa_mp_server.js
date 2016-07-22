'use strict'

const ilog = require('ilog')
const net = require('..')
const thunk = require('thunks')()
const Msgp = require('msgp')
const jsonrpc = require('jsonrpc-lite')
const auth = new net.Auth('secretxxx')
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

const server = new net.Server(function (socket) {
  let address = socket.address()
  ilog.info(`[${address.address}]:${address.port} connected`)
  thunk(function * () {
    for (let value of socket) {
      let message = yield value
      socket.success(message.payload.id, 'pong')
      // thunk.delay(1000)(() => socket.success(message.payload.id, 'pong'))
    }
    ilog.info(`[${address.address}]:${address.port} disconnected`)
  })(ilog.error)
})
server.getAuthenticator = function () {
  return (signature) => auth.verify(signature)
}

server.listen(3001, () => ilog.info('Server start'))
