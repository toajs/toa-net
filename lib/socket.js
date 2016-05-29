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
    this.closed = false
    this.connected = false
    this._queue = new Queue()
    this.rpcCount = 0
    this.rpcPending = 0
    this.rpcPendingPool = Object.create(null)
  }

  init (socket, authentication) {
    if (this.socket || socket.resp) throw new Error('"socket" exists.')
    this.socket = socket

    socket._toaCloseListener = (hadError) => {
      this.closed = true
      this.connected = false
      this.emit('close', hadError)
    }
    socket
      .on('error', (error) => this.emit('error', error))
      .on('timeout', () => this.emit('timeout'))
      .on('drain', () => this.emit('drain'))
      .on('end', () => this.emit('end'))
      .on('close', socket._toaCloseListener)

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
      let command = this._rpcCommand('auth', [authentication], (err, res) => {
        if (err) this.emit('error', err)
        else this.emit('auth', res)
      })
      this._queue.unshift(command.data)
    }
  }

  _onMessage (message) {
    let rpc = message.payload.id && this.rpcPendingPool[message.payload.id]
    if (rpc) {
      // responce of RPC
      if (message.type === 'success') return rpc.done(null, message.payload.result)
      else if (message.type === 'error') return rpc.done(message.payload.error)
    }
    this.emit('message', message)
  }

  _flushCommand (msgBuf) {
    if (!this.connected || this.rpcPending) {
      if (msgBuf) this._queue.push(msgBuf)
      return this
    }
    this.rpcPending = 0

    let bufs = []
    let maxPipeline = 256
    while (this._queue.length && --maxPipeline) {
      let buf = this._queue.shift()
      this.rpcPending += buf.length
      bufs.push(buf)
    }
    if (msgBuf) {
      if (this._queue.length) this._queue.push(msgBuf)
      else {
        this.rpcPending += msgBuf.length
        bufs.push(msgBuf)
      }
    }
    if (this.rpcPending) {
      msgBuf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs, this.rpcPending)
      this.socket.write(msgBuf, () => {
        this.rpcPending = 0
        this._flushCommand()
      })
    }
    return this
  }

  _rpcCommand (method, params, done) {
    let command = new Command(method, params, done)
    this.rpcPendingPool[command.id] = command
    command.cleanup.push(() => {
      delete this.rpcPendingPool[command.id]
    })
    return command
  }

  request (method, params) {
    return thunk.call(this, (done) => {
      this.rpcCount++
      if (this.closed) throw new Error('Client have been closed!')
      let command = this._rpcCommand(method, params, done)
      this._flushCommand(command.data)
    })
  }

  notification (method, params) {
    let msgObj = jsonrpc.notification(method, params)
    let data = Resp.encodeBulk(JSON.stringify(msgObj))
    this._flushCommand(data)
  }

  success (id, result) {
    let msgObj = jsonrpc.success(id, result)
    let data = Resp.encodeBulk(JSON.stringify(msgObj))
    this._flushCommand(data)
  }

  error (id, error) {
    let msgObj = jsonrpc.error(id, this.createError(error))
    let data = Resp.encodeBulk(JSON.stringify(msgObj))
    this._flushCommand(data)
  }

  createError (message, code, data) {
    if (message instanceof jsonrpc.JsonRpcError) {
      if (Number.isInteger(code)) message.code = code
      if (data !== null) message.data = data
      return message
    }

    if (message instanceof Error) {
      let err = new jsonrpc.JsonRpcError(message.message, code || message.code, data || message.data)
      err.stack = message.stack
      return err
    }

    if (Number.isInteger(message)) {
      data = code
      code = message
      switch (code) {
        case -32600:
          return jsonrpc.JsonRpcError.invalidRequest(data)
        case -32601:
          return jsonrpc.JsonRpcError.methodNotFound(data)
        case -32602:
          return jsonrpc.JsonRpcError.invalidParams(data)
        case -32603:
          return jsonrpc.JsonRpcError.internalError(data)
        case -32700:
          return jsonrpc.JsonRpcError.parseError(data)
        default:
          return new jsonrpc.JsonRpcError('Unknown error', code, data)
      }
    }
    return new jsonrpc.JsonRpcError(message, code, data)
  }

  throw () {
    throw this.createError.apply(this, arguments)
  }

  handleJsonRpc (jsonRpc, handleFn) {
    return thunk.call(this, function * () {
      if (!(jsonRpc instanceof jsonrpc.JsonRpc)) {
        throw jsonrpc.JsonRpcError.invalidRequest(jsonRpc)
      }

      let rpcId = jsonRpc.name === 'request' && jsonRpc.id
      try {
        let res = yield handleFn.call(this, jsonRpc)
        if (rpcId) this.success(rpcId, res || null)
      } catch (err) {
        if (rpcId) this.error(rpcId, err)
        else throw err
      }
    })
  }

  address () {
    return this.socket.address()
  }

  destroy () {
    if (this.closed) return
    this.connected = false
    this.closed = true
    Object.keys(this.rpcPendingPool)
      .map((id) => this.rpcPendingPool[id].done(new Error('Client have been closed!')))
    this.socket.removeAllListeners()
    this.socket.destroy()
    this.emit('close')
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
    let closed = this.closed
    let mixQueue = new Queue()

    this.on('message', (message) => {
      if (typeof mixQueue.first() === 'function') {
        mixQueue.shift()(null, message)
      } else mixQueue.push(message)
    })
    this.on('close', (hadError) => {
      closed = true
      // cleanup the last value
      let value = mixQueue.shift()
      if (typeof value === 'function') {
        if (hadError) value(new Error('Socket have been closed!'))
        else value(null)
      }
    })
    return new SocketIterator(mixQueue, () => !closed)
  }
}

class SocketIterator {
  constructor (queue, onLive) {
    this._queue = queue
    this._isAlive = onLive
  }

  next () {
    let value
    if (this._isAlive()) {
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
