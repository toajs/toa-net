'use strict'

const net = require('net')
const EventEmitter = require('events')

const Pool = require('./pool')
const Socket = require('./socket')

class Server extends EventEmitter {
  constructor (connectionListener) {
    super()

    this.connections = new Pool()
    this.server = net.createServer((_socket) => {
      let socket = new Socket()
      let authenticator = this.getAuthenticator()
      socket.init(_socket, authenticator)
      socket.connected = true
      this.connections.add(socket)
      socket.on('close', () => this.connections.remove(socket))

      if (!authenticator) connectionListener.call(this, socket)
      else {
        // invalid socket may throw error before 'auth', just destroy it.
        // i.e. probe socket from Server Load Balancer
        let initErrorListener = (err) => {
          socket.destroy()
          err.socket = socket
          // emit 'warn' to server, not 'error', because it is not server error.
          this.emit('warn', err)
        }

        socket.once('error', initErrorListener)
          .once('auth', () => {
            socket.removeListener('error', initErrorListener)
            connectionListener.call(this, socket)
          })
      }
    })
      .on('error', (error) => this.emit('error', error))
      .on('listening', () => this.emit('listening'))
      .on('close', () => this.emit('close'))
  }

  address () {
    return this.server.address()
  }

  // Abstract method. Should be overridden to enable authentication.
  getAuthenticator () {
    return null // Disable authentication
  }

  close () {
    for (let socket of this.connections) socket.destroy()
    this.connections.reset()
    this.server.close.apply(this.server, arguments)
  }

  listen () {
    return this.server.listen.apply(this.server, arguments)
  }
}

module.exports = Server
