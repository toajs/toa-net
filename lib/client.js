'use strict'

const net = require('net')

const Socket = require('./socket')

class Client extends Socket {
  constructor (options) {
    super()

    options = options || {}
    this.RETRY_DELAY = 3000
    this.MAX_ATTEMPTS = 50
    this.attempts = 0
    this.auth = options.auth
  }

  resendRpc () {
    let len = 0
    let bufs = []
    Object.keys(this.rpcPendingPool)
      .sort((a, b) => +a - b)
      .map((id) => {
        if (this.rpcPendingPool[id].pending) return
        this.rpcPendingPool[id].pending = true
        len += this.rpcPendingPool[id].data.length
        bufs.push(this.rpcPendingPool[id].data)
      })
    if (len) this.socket.write(Buffer.concat(bufs, len))
  }

  connect () {
    if (this.ended) return this
    if (this.socket) {
      this.socket.unpipe(this.socket.resp)
      this.socket.removeAllListeners(['connect', 'data', 'error', 'end', 'close'])
      this.socket.destroy()
      this.socket = null
    }

    let socket = net.createConnection.apply(null, arguments)

    socket.setTimeout(0)
    socket.setNoDelay(true)
    socket.setKeepAlive(true)

    socket
      .on('close', () => this.reconnect())
      .on('connect', () => {
        this.attempts = 0
        this.RETRY_DELAY = 3000
      })

    this.init(socket, this.auth)
    return this
  }

  reconnect () {
    if (this.ended) return
    // Reset rpcPendingPool.
    Object.keys(this.rpcPendingPool).map((id) => {
      this.rpcPendingPool[id].pending = false
    })

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
