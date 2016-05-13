'use strict'
// **Github:** https://github.com/toajs/toa-net
//
// **License:** MIT

const tman = require('tman')
const assert = require('assert')
const thunk = require('thunks')()
const net = require('..')

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
  let port = 10000
  this.timeout(10000)

  tman.it('work without auth', function * () {
    let server = new net.Server(function (socket) {
      socket.on('message', (message) => {
        if (message.type === 'request') {
          socket.success(message.payload.id, message.payload.params)
        }
      })
    })
    server.listen(port)

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
    let auth = new net.Auth('secretxxx')
    let server = new net.Server(function (socket) {
      assert.strictEqual(socket.session.id, 'test')

      socket.on('message', (message) => {
        if (message.type === 'request') {
          socket.success(message.payload.id, message.payload.params)
        }
      })
    }, {auth: auth})
    server.listen(port)

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
    let auth = new net.Auth('secretxxx')
    let server = new net.Server(function (socket) {
      assert.strictEqual(socket.session.id, 'test')

      thunk(function * () {
        let result = []

        for (let value of socket) {
          let message = yield value

          if (message.type === 'request') {
            assert.strictEqual(message.payload.method, 'echo')
            result.push(message.payload.params)
            socket.success(message.payload.id, 'OK')
            socket.destroy()
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
    server.listen(port)

    let client = new net.Client({auth: auth.sign({id: 'test'})})
    client.connect(port)

    client.notification('hello', [1])
    client.notification('hello', [2])
    client.notification('hello', [3])
    client.request('echo', {a: 4})()
  })

  tman.it('iterator in client-side', function * () {
    let auth = new net.Auth('secretxxx')
    let server = new net.Server(function (socket) {
      assert.strictEqual(socket.session.id, 'test')

      socket.notification('hello', [1])
      socket.notification('hello', [2])
      socket.notification('hello', [3])
      socket.request('echo', {a: 4})()
    }, {auth: auth})
    server.listen(port)

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
})

tman.it.skip('Chaos', function () {})
