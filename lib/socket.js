'use strict'

// const Msgp = require('msgp')
const Resp = require('respjs')
const thunk = require('thunks')()
const jsonrpc = require('jsonrpc-lite')
const EventEmitter = require('events').EventEmitter

const Queue = require('./queue')
const Command = require('./command')
const slice = Array.prototype.slice
const HIGHT_WATER_MARK = 16 * 1024

var sid = 0
class Socket extends EventEmitter {
  constructor () {
    super()
    this.sid = sid++
    this.socket = null
    this.closed = false
    this.connected = false
    this.rpcCount = 0
    this.ntfyCount = 0
    this._writeBytes = 0
    this._iter = null
    this._authCommand = null
    this._queue = new Queue()
    this.rpcPendingPool = Object.create(null)
  }

  get iterQueLen () {
    return this._iter ? this._iter._queue.length : 0
  }

  get queLen () {
    this._queue.length
  }

  init (socket, authenticate) {
    if (this.socket) throw new Error('"socket" exists.')
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

    this._initBufParser(socket)
      .on('error', (error) => this.emit('error', error))
      .once('data', (data) => this._onHandshake(data, authenticate))

    if (this._authCommand) this._authCommand.clear()
    if (authenticate && typeof authenticate === 'string') {
      // auth request for client mode
      this._authCommand = this._rpcCommand('auth', [authenticate], (err, res) => {
        this._authCommand = null
        if (err == null) this.emit('auth', res)
        else {
          this.emit('error', err)
          if (err.code === 401) this.destroy()
        }
      })
      this.socket.write(this._encodeBuf(this._authCommand.data))
    }
  }

  _initBufParser (socket) {
    socket.parser = new Resp({bufBulk: true})
    socket.pipe(socket.parser)
    return socket.parser
  }

  // Abstract method. Can be overridden.
  _encodeBuf (bufOrStr) {
    return Buffer.isBuffer(bufOrStr) ? Resp.encodeBufBulk(bufOrStr) : Resp.encodeBulk(bufOrStr)
  }

  // Abstract method. Can be overridden.
  _encodeMsg (jsonRpcObj) {
    return JSON.stringify(jsonRpcObj)
  }

  // Abstract method. Can be overridden.
  _decodeMsg (buf) {
    return jsonrpc.parse(buf.toString())
  }

  _onHandshake (data, authenticate) {
    if (isFn(authenticate)) {
      let res = this._decodeMsg(data)
      // authenticate for server mode
      if (res.type !== 'request' || res.payload.method !== 'auth') {
        let error = new Error('Invalid data: ' + JSON.stringify(res))
        error.name = 'Unauthorized'
        return this.socket.end(this._encodeBuf(this._encodeMsg(error)))
      }

      // params: [signature]
      try {
        this.session = authenticate(res.payload.params[0])
        this.success(res.payload.id, 'OK')
        this.emit('auth')
      } catch (error) {
        let msgObj = jsonrpc.error(res.payload.id, this.createError('Unauthorized', 401, String(error)))
        return this.socket.end(this._encodeBuf(this._encodeMsg(msgObj)))
      }
    } else {
      this._onMessage(data)
    }

    this.socket.parser.on('data', this._onMessage.bind(this))
  }

  _onMessage (data) {
    let message = this._decodeMsg(data)
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
    while (this._queue.length && this._writeBytes < HIGHT_WATER_MARK) {
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
      this._flushCommand(this._encodeBuf(command.data))
    })
  }

  notification (method, params) {
    this.ntfyCount++
    this._flushCommand(this._encodeBuf(this._encodeMsg(jsonrpc.notification(method, params))))
  }

  success (id, result) {
    this._flushCommand(this._encodeBuf(this._encodeMsg(jsonrpc.success(id, result))))
  }

  error (id, error) {
    this._flushCommand(this._encodeBuf(this._encodeMsg(jsonrpc.error(id, this.createError(error)))))
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

      let res
      let rpcId = jsonRpc.name === 'request' && jsonRpc.id
      try {
        res = yield handleFn.call(this, jsonRpc)
        if (rpcId !== false) this.success(rpcId, res || null)
      } catch (err) {
        if (rpcId !== false) this.error(rpcId, err)
        else throw err
      }
      return res
    })
  }

  address () {
    return this.socket.address()
  }

  destroy () {
    if (this.closed) return
    this.connected = false
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)

    let bufs = []
    while (this._queue.length) bufs.push(this._queue.shift())
    if (bufs.length) this.socket.write(Buffer.concat(bufs))
    this.socket.removeAllListeners()
    this.socket.destroy()

    Object.keys(this.rpcPendingPool)
      .forEach((id) => {
        let error = new Error('socket hang up')
        error.code = 'ECONNRESET'
        this.rpcPendingPool[id].done(error)
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

  intoIter () {
    return this[Symbol.iterator]()
  }

  [Symbol.iterator] () {
    // Should be called only once!
    if (this._iter) throw new Error('socket iterator exists')
    this._iter = new SocketIterator(new Queue(), this.closed)

    this.on('message', (message) => {
      let queue = this._iter._queue
      if (isFn(queue.first())) queue.shift()(null, message)
      else queue.push(message)
    })
    this.on('close', (hadError) => {
      this._iter.closed = true
      let queue = this._iter._queue
      // cleanup the iterator value
      if (isFn(queue.first())) {
        let error = new Error('socket hang up')
        error.code = 'ECONNRESET'
        queue.shift()(error)
      }
    })
    return this._iter
  }
}

class SocketIterator {
  constructor (queue, closed) {
    this.closed = closed
    this._queue = queue
  }

  next () {
    let value
    let queue = this._queue

    // we should consume previous value before calling `next`
    // otherwise iterator will be stoped
    if (isFn(queue.first())) this.closed = true
    if (!this.closed) {
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
