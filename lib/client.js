'use strict'

const net = require('net')
const url = require('url')
const Socket = require('./socket')
const slice = Array.prototype.slice

class Client extends Socket {
  constructor (options) {
    super()

    this.options = options || {}
    this.RETRY_DELAY = this.options.retryDelay > 0 ? Math.ceil(this.options.retryDelay) : 500
    this.MAX_ATTEMPTS = this.options.maxAttempts > 0 ? Math.ceil(this.options.maxAttempts) : 50
    this.attempts = 0
    this.reconnectTimer = null
  }

  connect () {
    if (this.closed) return this
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }

    let connectListener
    if (arguments.length) {
      // save for reconnect
      this.connectOptions = parseConnectOptions.apply(null, arguments)
      if (this.connectOptions.connectListener) {
        connectListener = this.connectOptions.connectListener
        delete this.connectOptions.connectListener
      }
    }
    let socket = net.createConnection(this.connectOptions, connectListener)

    socket.setTimeout(Math.ceil(this.options.tcpTimeout) || 0)
    socket.setNoDelay(this.options.tcpNoDelay !== false)
    socket.setKeepAlive(this.options.tcpKeepAlive !== false)
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (++this.attempts <= this.MAX_ATTEMPTS) {
      this.RETRY_DELAY = Math.floor(this.RETRY_DELAY * 1.2)
      if (this.RETRY_DELAY > 10000) this.RETRY_DELAY = 10000

      this.reconnectTimer = setTimeout(() => {
        if (this.closed) return
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

function parseConnectOptions () {
  let args = slice.call(arguments)
  let options = {}

  if (typeof args[args.length - 1] === 'function') {
    options.connectListener = args[args.length - 1]
    args.pop()
  }

  switch (typeof args[0]) {
    case 'object':
      Object.assign(options, args[0])
      break
    case 'number':
      options.port = args[0]
      if (typeof args[1] === 'string') options.host = args[1]
      break
    case 'string':
      let urlObj = url.parse(args[0])
      if (urlObj.hostname) options.host = urlObj.hostname
      if (urlObj.port) options.port = parseInt(urlObj.port, 10)
      if (urlObj.path) options.path = urlObj.path
      break
  }
  return options
}

module.exports = Client
