'use strict'
// **Github:** https://github.com/toajs/toa-net
//
// **License:** MIT

exports.Resp = require('respjs')
exports.Msgp = require('msgp')
exports.jsonrpc = require('jsonrpc-lite')
exports.Auth = require('./auth')
exports.Socket = require('./socket')
exports.Client = require('./client')
exports.Server = require('./server')
exports.Queue = require('./queue')
exports.RPCCommand = require('./command')

exports.useMsgp = function () {
  const Msgp = require('msgp')

  exports.Socket.prototype._initBufParser = function (socket) {
    socket.parser = new Msgp()
    socket.pipe(socket.parser)
    return socket.parser
  }

  exports.Socket.prototype._encodeBuf = function (bufOrStr) {
    return Msgp.encode(bufOrStr)
  }
}
