'use strict'

const net = require('net')
const thunk = require('thunks')()
const EventEmitter = require('events').EventEmitter

const Socket = require('./socket')

class Server extends EventEmitter {
  constructor (connectionListener) {
    super()

    this.server = net.createServer((_socket) => {
      let socket = new Socket()
      let authenticator = this.getAuthenticator()
      socket.init(_socket, authenticator)
      socket.connected = true

      if (!authenticator) connectionListener.call(this, socket)
      else socket.once('auth', () => connectionListener.call(this, socket))
    })
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

  // Abstract method. Should be overridden to enable authentication.
  getAuthenticator () {
    return null // Disable authentication
  }

  close () {
    this.server.close.apply(this.server, arguments)
  }

  listen () {
    return this.server.listen.apply(this.server, arguments)
  }
}

module.exports = Server
