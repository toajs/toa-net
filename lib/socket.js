'use strict'

const Resp = require('respjs')
const thunk = require('thunks')()
const jsonrpc = require('jsonrpc-lite')
const EventEmitter = require('events').EventEmitter

const Queue = require('./queue')
const Command = require('./command')
const slice = Array.prototype.slice

var sid = 0
class Socket extends EventEmitter {

  constructor () {
    super()
    this.sid = sid++
    this.socket = null
    this.closed = false
    this.connected = false
    this.rpcCount = 0
    this._writeBytes = 0
    this._authCommand = null
    this._queue = new Queue()
    this.rpcPendingPool = Object.create(null)
  }

  init (socket, authenticate) {
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

        if (isFn(authenticate)) {
          // authenticate for server mode
          if (res.type !== 'request' || res.payload.method !== 'auth') {
            let error = new Error('Invalid data: ' + message)
            error.name = 'Unauthorized'
            return socket.end(Resp.encodeError(error))
          }

          // params: [signature]
          try {
            this.session = authenticate(res.payload.params[0])
            this.success(res.payload.id, 'OK')
            this.emit('auth')
          } catch (error) {
            let msgObj = jsonrpc.error(res.payload.id, this.createError('Unauthorized', 401, String(error)))
            return socket.end(Resp.encodeBulk(JSON.stringify(msgObj)))
          }
        } else {
          this._onMessage(res)
        }

        socket.resp.on('data', (message) => {
          this._onMessage(jsonrpc.parse(message))
        })
      })

    if (this._authCommand) this._authCommand.clear()
    if (authenticate && typeof authenticate === 'string') {
      // auth request for client mode
      this._authCommand = this._rpcCommand('auth', [authenticate], (err, res) => {
        this._authCommand = null
        if (err) this.emit('error', err)
        else this.emit('auth', res)
      })
      this.socket.write(this._authCommand.data)
    }
  }

  _onMessage (message) {
    if (message.type === 'invalid') return this.emit('error', message.payload)
    let rpc = message.payload.id && this.rpcPendingPool[message.payload.id]
    if (rpc) {
      // responce of RPC
      if (message.type === 'success') return rpc.done(null, message.payload.result)
      else if (message.type === 'error') return rpc.done(message.payload.error)
    }
    this.emit('message', message)
  }

  _flushCommand (msgBuf) {
    if (!this.connected || this._writeBytes) {
      if (msgBuf) this._queue.push(msgBuf)
      return this
    }
    this._writeBytes = 0

    let bufs = []
    let maxPipeline = 256
    while (this._queue.length && --maxPipeline) {
      let buf = this._queue.shift()
      this._writeBytes += buf.length
      bufs.push(buf)
    }
    if (msgBuf) {
      if (this._queue.length) this._queue.push(msgBuf)
      else {
        this._writeBytes += msgBuf.length
        bufs.push(msgBuf)
      }
    }
    if (this._writeBytes) {
      msgBuf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs, this._writeBytes)
      this.socket.write(msgBuf, () => {
        this._writeBytes = 0
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
      if (this.closed) throw new Error('socket was closed!')
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
      if (Number.isSafeInteger(code)) message.code = code
      if (data !== null) message.data = data
      return message
    }

    if (message instanceof Error) {
      let err = new jsonrpc.JsonRpcError(message.message, code || message.code, data || message.data)
      err.stack = message.stack
      return err
    }

    if (Number.isSafeInteger(message)) {
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
          return new jsonrpc.JsonRpcError('Unknown error', code, slice.call(arguments))
      }
    }
    return new jsonrpc.JsonRpcError(message || 'Unknown error', code, data)
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

    let bufs = []
    while (this._queue.length) bufs.push(this._queue.shift())
    if (bufs.length) this.socket.write(Buffer.concat(bufs))
    this.socket.removeAllListeners()
    this.socket.destroy()

    Object.keys(this.rpcPendingPool)
      .forEach((id) => {
        this.rpcPendingPool[id].done(new Error('socket was closed!'))
      })
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
    let queue = new Queue()

    this.on('message', (message) => {
      if (isFn(queue.first())) queue.shift()(null, message)
      else queue.push(message)
    })
    this.on('close', (hadError) => {
      closed = true
      // cleanup the iterator value
      if (isFn(queue.first())) {
        let error = new Error('socket hang up')
        error.code = 'ECONNRESET'
        queue.shift()(error)
      }
    })
    return new SocketIterator(queue, () => !closed)
  }
}

class SocketIterator {
  constructor (queue, onLive) {
    this._queue = queue
    this._isAlive = onLive
  }

  next () {
    let value
    let queue = this._queue

    // we should consume previous value before calling `next`
    // otherwise iterator will be stoped
    if (isFn(queue.first())) this._isAlive = () => false

    if (this._isAlive()) {
      value = thunk((done) => {
        if (!queue.length) queue.push(done)
        else done(null, queue.shift())
      })
    } else {
      // consume queue when iterator terminated
      while (queue.length) {
        let fn = queue.shift()
        if (isFn(fn)) fn(new Error('socket iterator was terminated!'))
      }
    }
    return new SocketIteratorResult(value)
  }
}

class SocketIteratorResult {
  constructor (value) {
    this.value = value
    this.done = !value
  }
}

function isFn (fn) {
  return typeof fn === 'function'
}

module.exports = Socket
