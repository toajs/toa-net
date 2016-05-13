'use strict'

const Resp = require('respjs')
const thunk = require('thunks')()
const jsonrpc = require('jsonrpc-lite')
const EventEmitter = require('events').EventEmitter

const Auth = require('./auth')
const Queue = require('./queue')
const Command = require('./command')

class Socket extends EventEmitter {

  constructor () {
    super()

    this.socket = null
    this.ended = false
    this.rpcCount = 0
    this.rpcPendingPool = Object.create(null)
  }

  init (socket, authentication) {
    if (this.socket || socket.resp) throw new Error('"socket" exists.')
    this.socket = socket
    socket
      .on('error', (error) => this.emit('error', error))
      .on('connect', () => this.emit('connect'))
      .on('timeout', () => this.emit('timeout'))
      .on('drain', () => this.emit('drain'))
      .on('close', (hadError) => this.emit('close', hadError))
      .on('end', () => this.emit('end'))

    socket.resp = new Resp()
    socket.pipe(socket.resp)
    socket.resp
      .on('error', (error) => this.emit('error', error))
      .once('data', (message) => {
        let res = jsonrpc.parse(message)

        if (authentication instanceof Auth) {
          // authenticate socket for server mode
          if (res.type !== 'request' || res.payload.method !== 'auth') {
            let error = new Error('Invalid data: ' + message)
            error.name = 'Unauthorized'
            return socket.end(Resp.encodeError(error))
          }

          // params: [signature]
          try {
            this.session = authentication.verify(res.payload.params[0])
            this.success(res.payload.id, 'OK')
            this.emit('auth')
          } catch (error) {
            error.name = 'Unauthorized'
            return socket.end(Resp.encodeError(error))
          }
        } else {
          this._onMessage(res)
        }

        socket.resp.on('data', (message) => {
          this._onMessage(jsonrpc.parse(message))
        })
      })

    if (authentication && typeof authentication === 'string') {
      // auth request for client mode
      this.request('auth', [authentication])((err, res) => {
        if (err) this.emit('error', err)
        else this.emit('auth', res)
      })
    }
  }

  _onMessage (message) {
    let rpc = message.payload.id > 0 && this.rpcPendingPool[message.payload.id]
    if (rpc) {
      // responce of RPC
      if (message.type === 'success') return rpc.done(null, message.payload.result)
      else if (message.type === 'error') return rpc.done(message.payload.error)
    }
    this.emit('message', message)
  }

  request (method, params) {
    return thunk.call(this, (done) => {
      this.rpcCount++
      if (this.ended) throw new Error('Client have been closed!')

      let command = new Command(method, params, done)
      command.pending = true
      this.rpcPendingPool[command.id] = command
      command.cleanup.push(() => {
        delete this.rpcPendingPool[command.id]
      })
      this.socket.write(command.data)
      return command
    })
  }

  notification (method, params) {
    let msgObj = jsonrpc.notification(method, params)
    let data = Resp.encodeBulk(JSON.stringify(msgObj))
    this.socket.write(data)
  }

  success (id, result) {
    let msgObj = jsonrpc.success(id, result)
    let data = Resp.encodeBulk(JSON.stringify(msgObj))
    this.socket.write(data)
  }

  error (id, error) {
    if (error instanceof Error && !(error instanceof jsonrpc.JsonRpcError)) {
      error = new jsonrpc.JsonRpcError(error.message, error.code, error.data)
    }
    let msgObj = jsonrpc.error(id, error)
    let data = Resp.encodeBulk(JSON.stringify(msgObj))
    this.socket.write(data)
  }

  address () {
    return this.socket.address()
  }

  destroy () {
    this.ended = true
    this.socket.destroy()
    Object.keys(this.rpcPendingPool)
      .map((id) => this.rpcPendingPool[id].done(new Error('Client have been closed!')))
  }

  inspect () {
    let res = Object.assign({}, this)

    if (res.socket) {
      let address = this.address()
      res.socket = `<Socket [${address.address}]:${address.port}>`
    }
    return res
  }

  [Symbol.iterator] () {
    let mixQueue = new Queue()
    this.on('message', (message) => {
      if (typeof mixQueue.first() === 'function') {
        mixQueue.shift()(null, message)
      } else mixQueue.push(message)
    })
    return new SocketIterator(mixQueue, () => !this.ended)
  }
}

class SocketIterator {
  constructor (queue, onLive) {
    this._queue = queue
    this._onLive = onLive
  }

  next () {
    let value
    if (this._onLive()) {
      value = thunk((done) => {
        if (typeof this._queue.first() === 'object') {
          done(null, this._queue.shift())
        } else this._queue.push(done)
      })
    } else {
      while (this._queue.length) {
        this._queue.shift()(new Error('Socket have been closed!'))
      }
    }
    return {
      value: value,
      done: !value
    }
  }
}

module.exports = Socket
