'use strict'
// **Github:** https://github.com/toajs/toa-net
//
// **License:** MIT

exports.Resp = require('respjs')
exports.Msgp = require('msgp')
exports.jsonrpc = require('jsonrpc-lite')

exports.Auth = require('./auth')
exports.Queue = require('./queue')
exports.Socket = require('./socket')
exports.Client = require('./client')
exports.Server = require('./server')
exports.RingPool = require('./pool')
exports.RPCCommand = require('./command')

exports.useMsgp = function (context) {
  const Msgp = require('msgp')
  context = context || exports.Socket.prototype

  context._initBufParser = function (socket) {
    socket.parser = new Msgp()
    socket.pipe(socket.parser)
    return socket.parser
  }

  context._encodeBuf = function (bufOrStr) {
    return Msgp.encode(bufOrStr)
  }
}
