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
    this.auth = this.options.auth
  }

  resendRpc () {
    let len = 0
    let bufs = []
    Object.keys(this.rpcPendingPool)
      .sort((a, b) => +a - b)
      .map((id) => {
        let command = this.rpcPendingPool[id]
        if (command.method === 'auth') {
          while (command.cleanup.length) command.cleanup.shift()()
          return
        }
        len += command.data.length
        bufs.push(command.data)
      })
    if (len) this.socket.write(Buffer.concat(bufs, len))
  }

  connect () {
    if (this.closed) return this
    if (this.socket) {
      this.socket.unpipe(this.socket.resp)
      this.socket.removeAllListeners(['connect', 'data', 'error', 'end', 'close'])
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
    this.init(socket, this.auth)
    socket.removeAllListeners(['connect', 'close'])

    socket
      .on('close', () => this.reconnect())
      .on('connect', () => {
        this.attempts = 0
        this.RETRY_DELAY = 500
        this.emit('connect')
      })
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
        this.resendRpc()
      }, this.RETRY_DELAY)
    } else {
      this.destroy()
    }
  }
}

module.exports = Client
