'use strict'

const Resp = require('respjs')
const jsonrpc = require('jsonrpc-lite')

class RPCCommand {
  constructor (method, params, callback) {
    this.id = idMaker()
    this.method = method
    this.callback = callback

    this.data = this._encode(jsonrpc.request(this.id, method, params))
    this.timer = setTimeout(() => {
      var error = new Error('Send RPC time out, ' + this.id)
      error.data = this.data
      this.done(error)
    }, RPCCommand.TIMEOUT)

    this.cleanup = [() => {
      clearTimeout(this.timer)
      this.timer = null
    }]
  }

  // Encode "JsonRpc object" to RESP buffer
  // Abstract method. Can be overridden.
  _encode (jsonRpcObj) {
    return Resp.encodeBulk(JSON.stringify(jsonRpcObj))
  }

  clear () {
    while (this.cleanup.length) this.cleanup.shift()()
  }

  done (err, res) {
    if (!this.timer) return
    this.clear()
    this.callback(err, res)
  }
}

var id = 0
function idMaker () {
  if (id === Number.MAX_SAFE_INTEGER) id = 0
  return RPCCommand.ISN + ':' + (++id).toString(36)
}

RPCCommand.TIMEOUT = 2 * 60 * 1000
RPCCommand.ISN = (Date.now() - new Date().setMinutes(0, 0, 0)).toString(36)
module.exports = RPCCommand
