'use strict'

const net = require('net')
const Socket = require('./socket')
const slice = Array.prototype.slice

class Client extends Socket {
  constructor (options) {
    super()

    this.options = options || {}
    this.RETRY_DELAY = 500
    this.MAX_ATTEMPTS = 50
    this.attempts = 0
  }

  connect () {
    if (this.closed) return this
    if (this.socket) {
      this.socket.unpipe(this.socket.resp)
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }

    if (arguments.length) {
      // save for reconnect
      this.connectOptions = slice.call(arguments)
      if (typeof this.connectOptions[this.connectOptions.length - 1] === 'function') {
        this.connectOptions.pop()
      }
    }
    let connectOptions = arguments.length ? arguments : this.connectOptions
    let socket = net.createConnection.apply(null, connectOptions)

    socket.setTimeout(0)
    socket.setNoDelay(true)
    socket.setKeepAlive(true)
    this.init(socket, this.getSignature())

    socket.removeListener('close', socket._toaCloseListener)
    socket._toaCloseListener = () => {
      this.connected = false
      this.reconnect()
    }
    socket._toaConnectListener = () => {
      this.connected = true
      this.attempts = 0
      this.RETRY_DELAY = 500
      this._flushCommand()
      this.emit('connect')
    }

    socket
      .on('close', socket._toaCloseListener)
      .on('connect', socket._toaConnectListener)
    return this
  }

  reconnect () {
    if (this.closed) return
    if (++this.attempts <= this.MAX_ATTEMPTS) {
      this.RETRY_DELAY *= 1.2
      if (this.RETRY_DELAY > 10000) this.RETRY_DELAY = 10000

      setTimeout(() => {
        this.connect()
        this.emit('reconnecting', {
          delay: this.RETRY_DELAY,
          attempts: this.attempts
        })
      }, this.RETRY_DELAY)
    } else {
      this.destroy()
    }
  }

  // Abstract method. Should be overridden to enable authentication.
  getSignature () {
    return '' // Disable authentication
  }
}

module.exports = Client
