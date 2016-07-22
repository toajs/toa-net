'use strict'
// **Github:** https://github.com/toajs/toa-net
//
// **License:** MIT

const tman = require('tman')
const assert = require('assert')
const thunk = require('thunks')()
const net = require('..')

// net.useMsgp()

var _port = 10000

tman.suite('Auth', function () {
  tman.it('work with a secret', function () {
    let auth = new net.Auth('secretxxx')
    let payload = {id: 'test'}
    let signature = auth.sign(payload)
    assert.strictEqual(auth.decode(signature).id, payload.id)
    assert.strictEqual(auth.verify(signature).id, payload.id)
  })

  tman.it('work with array of secret', function () {
    let auth1 = new net.Auth('secretxxx1')
    let payload = {id: 'test'}
    let signature1 = auth1.sign(payload)

    let auth2 = new net.Auth(['secretxxx2', 'secretxxx1'])
    let signature2 = auth2.sign(payload)

    assert.strictEqual(auth1.decode(signature1).id, payload.id)
    assert.strictEqual(auth2.decode(signature2).id, payload.id)

    assert.strictEqual(auth2.verify(signature1).id, payload.id)
    assert.throws(() => auth1.verify(signature2))
  })

  tman.it('expired', function * () {
    let auth = new net.Auth({
      secrets: ['secretxxx'],
      expiresIn: 1
    })
    let payload = {id: 'test'}
    let signature = auth.sign(payload)
    assert.strictEqual(auth.verify(signature).id, payload.id)

    yield thunk.delay(1000)
    assert.throws(() => auth.verify(signature), 'Expired')
  })
})

tman.suite('Server & Client', function () {
  this.timeout(10000)

  tman.it('work without auth', function * () {
    let port = _port++
    let server = new net.Server(function (socket) {
      socket.on('message', (message) => {
        if (message.type === 'request') {
          socket.success(message.payload.id, message.payload.params)
        }
      })
    })
    yield (done) => server.listen(port, done)

    let client = new net.Client()
    client.connect(port)

    client.notification('hello', [1])
    client.notification('hello', [2])
    client.notification('hello', [3])
    let res = yield client.request('echo', {a: 4})
    assert.deepEqual(res, {a: 4})
    res = yield client.request('echo', {a: 5})
    assert.deepEqual(res, {a: 5})
    res = yield client.request('echo', {a: 6})
    assert.deepEqual(res, {a: 6})

    client.destroy()
    yield (done) => server.close(done)
  })

  tman.it('work with auth', function * () {
    let port = _port++
    let auth = new net.Auth('secretxxx')
    let server = new net.Server(function (socket) {
      assert.strictEqual(socket.session.id, 'test')

      socket.on('message', (message) => {
        if (message.type === 'request') {
          socket.success(message.payload.id, message.payload.params)
        }
      })
    })
    server.getAuthenticator = function () {
      return (signature) => auth.verify(signature)
    }
    yield (done) => server.listen(port, done)

    let clientAuthorized = false
    let client = new net.Client()
      .on('auth', () => {
        clientAuthorized = true
      })
    client.getSignature = function () {
      return auth.sign({id: 'test'})
    }
    client.connect(port)

    client.notification('hello', [1])
    client.notification('hello', [2])
    client.notification('hello', [3])
    let res = yield client.request('echo', {a: 4})
    assert.strictEqual(clientAuthorized, true)
    assert.deepEqual(res, {a: 4})
    res = yield client.request('echo', {a: 5})
    assert.deepEqual(res, {a: 5})
    res = yield client.request('echo', {a: 6})
    assert.deepEqual(res, {a: 6})

    client.destroy()
    yield (done) => server.close(done)
  })

  tman.it('when auth error', function (callback) {
    let port = _port++
    let auth = new net.Auth('secretxxx')
    let server = new net.Server(function (socket) {
      socket.on('message', (message) => {
        if (message.type === 'request') {
          socket.success(message.payload.id, message.payload.params)
        }
      })
    })
    server.getAuthenticator = function () {
      return (signature) => auth.verify(signature)
    }
    server.listen(port)

    let clientAuthorized = false
    let client = new net.Client()
      .on('auth', () => {
        clientAuthorized = true
      })
    client.getSignature = function () {
      return 'error signature'
    }
    client.connect(port)

    client.once('error', (err) => {
      assert.strictEqual(err.message, 'Unauthorized')
      assert.strictEqual(err.code, 401)
      assert.strictEqual(err.data, 'Error: Invalid signature')
      assert.strictEqual(clientAuthorized, false)
    })
    client.on('close', () => {
      server.close(callback)
    })
  })

  tman.it('iterator in server-side', function (callback) {
    let port = _port++
    let auth = new net.Auth('secretxxx')
    let server = new net.Server(function (socket) {
      assert.strictEqual(socket.session.id, 'test')

      let result = []
      thunk(function * () {
        for (let value of socket) {
          let message = yield value

          if (message.type === 'request') {
            assert.strictEqual(message.payload.method, 'echo')
            result.push(message.payload.params)
            socket.success(message.payload.id, 'OK')
          } else {
            assert.strictEqual(message.type, 'notification')
            assert.strictEqual(message.payload.method, 'hello')
            result.push(message.payload.params)
          }
        }

        assert.deepEqual(result, [[1], [2], [3], {a: 4}])
        yield (done) => server.close(done)
      })((err) => {
        assert.strictEqual(err.code, 'ECONNRESET')
        assert.strictEqual(err.message, 'socket hang up')
        assert.deepEqual(result, [[1], [2], [3], {a: 4}])
        return (done) => server.close(done)
      })(callback)
    })
    server.getAuthenticator = function () {
      return (signature) => auth.verify(signature)
    }

    server.listen(port, () => {
      let client = new net.Client()
      client.getSignature = function () {
        return auth.sign({id: 'test'})
      }
      client.connect(port)

      client.notification('hello', [1])
      client.notification('hello', [2])
      client.notification('hello', [3])
      client.request('echo', {a: 4})(() => client.destroy())
    })
  })

  tman.it('iterator in client-side', function * () {
    let port = _port++
    let result = []
    let auth = new net.Auth('secretxxx')
    let server = new net.Server(function (socket) {
      assert.strictEqual(socket.session.id, 'test')

      socket.notification('hello', [1])
      socket.notification('hello', [2])
      socket.notification('hello', [3])
      socket.request('echo', {a: 4})((_, res) => {
        result.push(res)
        assert.deepEqual(result, [[1], [2], [3], 'OK'])
        server.close()
      })
    })
    server.getAuthenticator = function () {
      return (signature) => auth.verify(signature)
    }

    yield (done) => server.listen(port, done)

    let client = new net.Client()
    client.getSignature = function () {
      return auth.sign({id: 'test'})
    }
    client.connect(port)

    for (let value of client) {
      let message = yield value

      if (message.type === 'request') {
        assert.strictEqual(message.payload.method, 'echo')
        client.success(message.payload.id, 'OK')
        client.destroy()
      } else {
        assert.strictEqual(message.type, 'notification')
        assert.strictEqual(message.payload.method, 'hello')
        result.push(message.payload.params)
      }
    }
  })

  tman.it('createError', function () {
    let err = null
    err = net.Client.prototype.createError()
    assert.strictEqual(err instanceof net.jsonrpc.JsonRpcError, true)
    assert.strictEqual(err.code, 0)

    err = net.Client.prototype.createError('some error', 1, [1, 2, 3])
    assert.strictEqual(err instanceof net.jsonrpc.JsonRpcError, true)
    assert.strictEqual(err.message, 'some error')
    assert.strictEqual(err.code, 1)
    assert.deepEqual(err.data, [1, 2, 3])

    let err1 = net.Client.prototype.createError(err)
    assert.strictEqual(err1, err)

    let err2 = net.Client.prototype.createError(err1, 2)
    assert.strictEqual(err2, err1)
    assert.strictEqual(err2.code, 2)

    err = new Error('some error')
    err.code = 404

    err1 = net.Client.prototype.createError(err)
    assert.strictEqual(err1 instanceof net.jsonrpc.JsonRpcError, true)
    assert.strictEqual(err1.code, 404)

    err2 = net.Client.prototype.createError(err, 400, [1, 2, 3])
    assert.strictEqual(err2 instanceof net.jsonrpc.JsonRpcError, true)
    assert.strictEqual(err2.code, 400)
    assert.deepEqual(err2.data, [1, 2, 3])

    err = net.Client.prototype.createError(-32600)
    assert.strictEqual(err instanceof net.jsonrpc.JsonRpcError, true)
  })

  tman.it('throw', function () {
    assert.throws(() => {
      net.Client.prototype.throw(-32600)
    }, net.jsonrpc.JsonRpcError)

    assert.throws(() => {
      net.Client.prototype.throw(new Error('some error'))
    }, net.jsonrpc.JsonRpcError)

    assert.throws(() => {
      net.Client.prototype.throw(net.Client.prototype.createError())
    }, net.jsonrpc.JsonRpcError)

    assert.throws(() => {
      net.Client.prototype.throw('some error', 400)
    }, net.jsonrpc.JsonRpcError)
  })

  tman.suite('handleJsonRpc', function () {
    tman.it('handle success', function (callback) {
      let port = _port++
      let auth = new net.Auth('secretxxx')
      let server = new net.Server(function (socket) {
        let result = []
        thunk(function * () {
          for (let value of socket) {
            let message = yield value
            yield socket.handleJsonRpc(message.payload, function (jsonRpc) {
              result.push(jsonRpc.params)
              return 'OK'
            })
          }
        })((err) => {
          assert.strictEqual(err.code, 'ECONNRESET')
          assert.deepEqual(result, [[1], [2], [3], {a: 4}])
          return (done) => server.close(done)
        })(callback)
      })
      server.getAuthenticator = function () {
        return (signature) => auth.verify(signature)
      }

      server.listen(port, () => {
        let client = new net.Client()
        client.getSignature = function () {
          return auth.sign({id: 'test'})
        }
        client.connect(port)

        client.notification('hello', [1])
        client.notification('hello', [2])
        client.notification('hello', [3])
        client.request('echo', {a: 4})((_, res) => {
          assert.strictEqual(res, 'OK')
          client.destroy()
        })
      })
    })

    tman.it('handle error', function (callback) {
      let port = _port++
      let auth = new net.Auth('secretxxx')
      let server = new net.Server(function (socket) {
        let result = []
        thunk(function * () {
          for (let value of socket) {
            let message = yield value
            yield socket.handleJsonRpc(message.payload, function (jsonRpc) {
              result.push(jsonRpc.params)
              if (jsonRpc.name === 'request') this.throw('some error', 499, result)
            })
          }
        })((err) => {
          assert.strictEqual(err instanceof Error, true)
          return (done) => server.close(done)
        })(callback)
      })
      server.getAuthenticator = function () {
        return (signature) => auth.verify(signature)
      }

      server.listen(port, () => {
        let client = new net.Client()
        client.getSignature = function () {
          return auth.sign({id: 'test'})
        }
        client.connect(port)

        client.notification('hello', [1])
        client.notification('hello', [2])
        client.notification('hello', [3])
        client.request('echo', {a: 4})((err, res) => {
          assert.strictEqual(err instanceof net.jsonrpc.JsonRpcError, true)
          assert.strictEqual(err.code, 499)
          client.destroy()
        })
      })
    })
  })

  tman.it('reconnect when server restart', function (callback) {
    let port = _port++
    let server = new net.Server(function (socket) {
      socket.on('error', (err) => {
        assert.strictEqual(err instanceof Error, true)
      })
    })

    server.listen(port)

    let client = new net.Client()
    let reconnecting = false
    let serverClosed = 0
    client
      .on('error', (err) => {
        assert.strictEqual(err instanceof Error, true)
      })
      .on('connect', () => {
        if (reconnecting) client.destroy()
        else {
          server.close(() => {
            serverClosed++
            server.listen(port)
          })
        }
      })
      .on('reconnecting', () => {
        reconnecting = true
      })
      .on('close', () => {
        assert.strictEqual(serverClosed, 1)
        assert.strictEqual(reconnecting, true)
        callback()
      })

    client.connect(port)
  })

  tman.it('reconnect when client closed', function * () {
    let port = _port++
    let auth = new net.Auth('secretxxx')
    let recvSocket = 0
    let server = new net.Server(function (socket) {
      recvSocket++
      thunk(function * () {
        for (let value of socket) {
          let message = yield value
          socket.success(message.payload.id, message.payload.params.index)
        }
      })((err) => {
        assert.strictEqual(err instanceof Error, true)
      })
    })
    server.getAuthenticator = function () {
      return (signature) => auth.verify(signature)
    }

    yield (done) => server.listen(port, done)

    let client = new net.Client()
    client.getSignature = function () {
      return auth.sign({id: 'test'})
    }
    client.connect(port)

    let reconnectingMsg = null
    client.on('reconnecting', (msg) => {
      reconnectingMsg = msg
    })
    yield (done) => client.once('connect', done)

    assert.strictEqual(1, yield client.request('test', {index: 1}))
    assert.strictEqual(2, yield client.request('test', {index: 2}))
    assert.strictEqual(3, yield client.request('test', {index: 3}))

    client.socket.destroy() // cut socket, then auto reconnect
    yield (done) => client.once('connect', done)
    assert.strictEqual(4, yield client.request('test', {index: 4}))
    assert.strictEqual(5, yield client.request('test', {index: 5}))

    assert.strictEqual(recvSocket, 2)
    assert.strictEqual(reconnectingMsg.attempts, 1)

    client.destroy()
    yield (done) => server.close(done)
  })
})

tman.it('Chaos', function * () {
  this.timeout(0)

  let index = 0
  let port = _port++
  let job = {
    name: 'abcdefghijklmnopqrst',
    email: 'abcdefghijklmnopqrst@test.com',
    location: 'zhangjiang, shanghai, china'
  }
  let count = 0
  let maxIterQueLen = 0
  let auth = new net.Auth('secretxxx')
  let server = new net.Server(function (socket) {
    thunk(function * () {
      for (let value of socket) {
        maxIterQueLen = Math.max(maxIterQueLen, socket.iterQueLen)

        let message = yield value
        count += JSON.stringify(message.payload).length
        // socket.success(message.payload.id, message.payload.params.id)
        let latency = 100
        thunk.delay(latency)(() => socket.success(message.payload.id, message.payload.params.id))
      }
    })((err) => {
      assert.strictEqual(err.code, 'ECONNRESET')
      assert.strictEqual(maxIterQueLen > 0, true)
    })
  })
  server.getAuthenticator = function () {
    return (signature) => auth.verify(signature)
  }
  yield (done) => server.listen(port, done)

  let client = new net.Client()
  let drainCount = 0
  client.getSignature = function () {
    return auth.sign({id: 'test'})
  }
  client.on('drain', () => drainCount++)
  client.connect(port)
  yield (done) => client.once('connect', done)

  let time = Date.now()
  let queue = []

  while (index < 100000) {
    let id = ++index
    // let res = yield client.request('test', Object.assign({id: id}, job))
    queue.push(client.request('test', Object.assign({id: id}, job))((_, res) => {
      assert.strictEqual(res, id)
      if (!(res % 100)) process.stdout.write('.')
    }))

    if (queue.length >= 1000) yield queue.shift()
  }
  // wait for all request.
  yield queue

  assert.strictEqual(drainCount > 0, true)
  time = Date.now() - time
  console.log('\nFinished', time, 'ms', (100000 / (time / 1000)).toFixed(2), 'ops/s', (count / time).toFixed(2), 'kb/s')

  client.destroy()
  yield (done) => server.close(done)
})
