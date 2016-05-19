'use strict'
// **Github:** https://github.com/toajs/toa-net
//
// **License:** MIT

const tman = require('tman')
const assert = require('assert')
const thunk = require('thunks')()
const net = require('..')

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
    }, {auth: auth})
    yield (done) => server.listen(port, done)

    let clientAuthorized = false
    let client = new net.Client({auth: auth.sign({id: 'test'})})
      .on('auth', () => {
        clientAuthorized = true
      })
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

  tman.it('iterator in server-side', function (callback) {
    let port = _port++
    let auth = new net.Auth('secretxxx')
    let server = new net.Server(function (socket) {
      assert.strictEqual(socket.session.id, 'test')

      thunk(function * () {
        let result = []

        for (let value of socket) {
          let message = yield value

          if (!message) continue
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
      })(callback)
    }, {auth: auth})

    server.listen(port, () => {
      let client = new net.Client({auth: auth.sign({id: 'test'})})
      client.connect(port)

      client.notification('hello', [1])
      client.notification('hello', [2])
      client.notification('hello', [3])
      client.request('echo', {a: 4})(() => client.destroy())
    })
  })

  tman.it('iterator in client-side', function * () {
    let port = _port++
    let auth = new net.Auth('secretxxx')
    let server = new net.Server(function (socket) {
      assert.strictEqual(socket.session.id, 'test')

      socket.notification('hello', [1])
      socket.notification('hello', [2])
      socket.notification('hello', [3])
      socket.request('echo', {a: 4})()
    }, {auth: auth})

    yield (done) => server.listen(port, done)

    let client = new net.Client({auth: auth.sign({id: 'test'})})
    client.connect(port)

    let result = []

    for (let value of client) {
      let message = yield value

      if (message.type === 'request') {
        assert.strictEqual(message.payload.method, 'echo')
        result.push(message.payload.params)
        client.success(message.payload.id, 'OK')
        client.destroy()
      } else {
        assert.strictEqual(message.type, 'notification')
        assert.strictEqual(message.payload.method, 'hello')
        result.push(message.payload.params)
      }
    }

    assert.deepEqual(result, [[1], [2], [3], {a: 4}])
    yield (done) => server.close(done)
  })

  tman.it.skip('createError', function () {})
  tman.it.skip('throw error', function () {})
  tman.it.skip('handleJsonRpc', function () {})

  tman.it('reconnect', function * () {
    let port = _port++
    let auth = new net.Auth('secretxxx')
    let recvSocket = 0
    let server = new net.Server(function (socket) {
      recvSocket++
      thunk(function * () {
        for (let value of socket) {
          let message = yield value
          if (!message) continue
          socket.success(message.payload.id, message.payload.params.index)
        }
      })()
    }, {auth: auth})

    yield (done) => server.listen(port, done)

    let client = new net.Client({auth: auth.sign({id: 'test'})})
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
  let auth = new net.Auth('secretxxx')
  let server = new net.Server(function (socket) {
    thunk(function * () {
      for (let value of socket) {
        let message = yield value
        if (message) {
          count += JSON.stringify(message.payload).length
          // socket.success(message.payload.id, message.payload.params.id)
          let latency = 100
          thunk.delay(latency)(() => socket.success(message.payload.id, message.payload.params.id))
        }
      }
    })()
  }, {auth: auth})
  yield (done) => server.listen(port, done)

  let client = new net.Client({auth: auth.sign({id: 'test'})})
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
  time = Date.now() - time
  console.log('\nFinished', time, 'ms', (100000 / (time / 1000)).toFixed(2), 'ops/s', (count / time).toFixed(2), 'kb/s')

  client.destroy()
  yield (done) => server.close(done)

  // ### 10 万次常规 message 请求测试：
  // - 无延时，串行，7380.62 ops/s
  // - 无延时，1000 并发，11450.82 ops/s
  // - 100ms 延时，1000 并发，5478.25 ops/s
  // - 500ms 延时，1000 并发，1768.35 ops/s
  //
  // **当前 aliyun 与 aws 的网络状况：单次请求 1000ms 左右**
  //
  // - 1000ms 延时，1000 并发，923.99 ops/s
  // - 1000ms 延时，2000 并发，1791.12 ops/s
  // - 1000ms 延时，10000 并发，4861.721 ops/s
})
