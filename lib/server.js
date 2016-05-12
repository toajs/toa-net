'use strict'

const net = require('net')
const thunk = require('thunks')()
const EventEmitter = require('events').EventEmitter

const Auth = require('./auth')
const Socket = require('./socket')

class Server extends EventEmitter {
  constructor (connectionListener, options) {
    super()

    options = options || {}

    this.auth = options.auth instanceof Auth ? options.auth : null
    this.server = net.createServer(initConnectionListener(connectionListener))
      .on('close', () => this.emit('close'))
      .on('error', (error) => this.emit('error', error))
      .on('listening', () => this.emit('listening'))
  }

  get listening () {
    return this.server.listening
  }

  address () {
    return this.server.address()
  }

  getConnections () {
    return thunk((callback) => this.server.getConnections(callback))
  }

  close () {
    this.server.listen.apply(this.server, arguments)
  }

  listen () {
    return this.server.listen.apply(this.server, arguments)
  }
}

function initConnectionListener (connectionListener) {
  return function (_socket) {
    const server = this
    const socket = new Socket()
    socket.init(_socket, server.auth)

    if (!server.auth) connectionListener.call(server, socket)
    else socket.once('auth', () => connectionListener.call(server, socket))
  }
}

module.exports = Server
