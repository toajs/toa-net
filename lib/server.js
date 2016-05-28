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
    this.server = net.createServer(initConnectionListener(connectionListener, this.auth))
      .on('close', () => this.emit('close'))
      .on('error', (error) => this.emit('error', error))
      .on('listening', () => this.emit('listening'))
  }

  address () {
    return this.server.address()
  }

  getConnections () {
    return thunk((callback) => this.server.getConnections(callback))
  }

  close () {
    this.server.close.apply(this.server, arguments)
  }

  listen () {
    return this.server.listen.apply(this.server, arguments)
  }
}

function initConnectionListener (connectionListener, authentication) {
  return function (_socket) {
    const server = this
    const socket = new Socket()
    socket.init(_socket, authentication)
    socket.connected = true

    if (!authentication) connectionListener.call(server, socket)
    else socket.once('auth', () => connectionListener.call(server, socket))
  }
}

module.exports = Server
