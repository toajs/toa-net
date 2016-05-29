'use strict'

const ilog = require('ilog')
const net = require('..')
const thunk = require('thunks')()
const auth = new net.Auth('secretxxx')

const server = new net.Server(function (socket) {
  let address = socket.address()
  ilog.info(`[${address.address}]:${address.port} connected`)
  thunk(function * () {
    for (let value of socket) {
      let message = yield value
      if (message) socket.success(message.payload.id, 'pong')
      // if (message) thunk.delay(1000)(() => socket.success(message.payload.id, 'pong'))
    }
    ilog.info(`[${address.address}]:${address.port} disconnected`)
  })(ilog.error)
}, {auth: auth})

server.listen(3001, () => ilog.info('Server start'))
