'use strict'

const Resp = require('respjs')
const jsonrpc = require('jsonrpc-lite')
const TIMEOUT = 60 * 1000

class Command {
  constructor (method, params, callback) {
    let ctx = this

    this.id = idMaker()
    this.method = method
    this.callback = callback

    var msgObj = jsonrpc.request(this.id, method, params)
    this.data = Resp.encodeBulk(JSON.stringify(msgObj))

    this.timer = setTimeout(function () {
      var error = new Error('Send RPC time out, ' + ctx.id + ', ' + ctx.method)
      error.data = msgObj
      ctx.done(error)
    }, TIMEOUT)

    this.cleanup = []
    this.cleanup.push(() => {
      clearTimeout(this.timer)
      this.timer = null
    })
  }

  done (err, res) {
    if (!this.timer) return
    while (this.cleanup.length) this.cleanup.shift()()
    this.callback(err, res)
  }
}

var id = 0
function idMaker () {
  if (id === Number.MAX_SAFE_INTEGER) id = 0
  return ++id
}

module.exports = Command
