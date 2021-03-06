# Toa-net

JSON-RPC 2.0 client/server over TCP net.

[![NPM version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]
[![Downloads][downloads-image]][downloads-url]

## Features

1. Use [JSON-RPC 2.0 Specification](http://www.jsonrpc.org/specification) as RPC protocol.
1. Use [RESP (Redis Serialization Protocol)](http://redis.io/topics/protocol) or [MsgP (Byte Message Protocol)](https://github.com/zensh/msgp-node) as message protocol.
1. Use [JSON Web Signatures](http://self-issued.info/docs/draft-ietf-jose-json-web-signature.html) as authentication protocol.
1. Implemented ES6 Iterable protocol.

## Implementations

- [snapper-core](https://github.com/teambition/snapper-core) Teambition push messaging service, based on redis.
- [snapper-producer](https://github.com/teambition/snapper-producer) Snapper producer client for node.js.

## Examples

### [Simple](https://github.com/toajs/toa-net/tree/master/example/simple.js)

```js
const net = require('toa-net')
const auth = new net.Auth('secretxxx')
const server = new net.Server(function (socket) {
  socket.on('message', (message) => {
    console.log(message)
    // { payload: { jsonrpc: '2.0', method: 'hello', params: [ 1 ] },
    //   type: 'notification' }
    // ...

    if (message.type === 'request') {
      // echo request
      socket.success(message.payload.id, message.payload.params)
    }
  })
})
server.listen(8000)

// Enable authentication for server
server.getAuthenticator = function () {
  return (signature) => auth.verify(signature)
}

const client = new net.Client()
// Enable authentication for client
client.getSignature = function () {
  return auth.sign({id: 'clientIdxxx'})
}
client.connect(8000)

client.notification('hello', [1])
client.notification('hello', [2])
client.notification('hello', [3])
client.request('echo', {a: 4})((err, res) => {
  console.log(err, res) // null { a: 4 }

  client.destroy()
  server.close()
})
```

### [Iterator](https://github.com/toajs/toa-net/tree/master/example/simple.js)

Socket is async iterable object!

```js
const thunk = require('thunks')()
const net = require('toa-net')

// 创建服务器
const server = new net.Server(function (socket) {
  thunk(function * () {
    // 高能！！！异步迭代 socket 接收的数据，socket 关闭后迭代结束
    for (let value of socket) {
      let message = yield value
      console.log(message)
      // { payload: { jsonrpc: '2.0', method: 'hello', params: [ 1 ] },
      //   type: 'notification' }
      // ...

      if (message.type === 'request') {
        // respond to the request
        socket.success(message.payload.id, message.payload.params)
      }
    }
  })((err) => {
    console.log(err)
    process.exit(0)
  })
})
server.listen(8000)

// 创建客户端
const client = new net.Client().connect(8000)
// 向服务器发出 notification
client.notification('hello', [1])
client.notification('hello', [2])
client.notification('hello', [3])
// 向服务器发出 RPC 请求，服务器将 echo 请求数据
client.request('echo', {a: 4})((err, res) => {
  console.log(err, res) // null { a: 4 }
  client.destroy()
  server.close()
})
```

## Bench https://github.com/toajs/toa-net/tree/master/bench

### gRPC vs axon vs toa-net, 5000000 Ping/Pong messages, 1 TCP connection, Node.js v6

1. gRPC, no-delay: **1000 cocurrency, 1240066 ms, 4032.04 ops**
1. axon, no-delay: **1000 cocurrency, 204176 ms, 148888.89 kb, 24488.68 ops**
1. toa-net, no-delay: **1000 cocurrency, 73789 ms, 263272.57 kb, 67760.78 ops**

### 100000 Ping/Pong messages

1. local -> local, no-delay: **1000 cocurrency, 3180ms, 31446 ops**
1. local -> local, delay 1000ms: **1000 cocurrency, 100590ms, 994 ops**
1. local -> local, delay 1000ms: **5000 cocurrency, 20869ms, 4791 ops**
1. local -> local, delay 1000ms: **10000 cocurrency, 11074ms, 9030 ops**

### 10000 simple messages, 1000 cocurrency

```js
// message
{
  name: 'abcdefghijklmnopqrst',
  email: 'abcdefghijklmnopqrst@test.com',
  location: 'zhangjiang, shanghai, china'
}
```

1. aliyun -> aws: **264321ms, 37 ops, 4.61 kb/s**
1. aws -> aliyun: **82129ms, 121 ops, 14.84 kb/s**
1. aliyun -> proxy_cn -> fiber -> proxy_us -> aws: **8056ms, 1241 ops, 151.30 kb/s**

## Install

```sh
npm install toa-net
```

## API

```js
const toaNet = require('toa-net')
```

### Class toaNet.Server

#### new toaNet.Server(connectionListener)

Create RPC server.

```js
const server = new net.Server(function (socket) {
  socket.on('message', (message) => {
    console.log(message)
  })
})
server.listen(8000)
```

1. `connectionListener`: *Required*, Type: `Function`.

#### Event: 'close'

#### Event: 'error'

#### Event: 'listening'

#### server.getAuthenticator()

Abstract method. Should be overridden to enable authentication.

Default:

```js
server.getAuthenticator = function () {
  return null // Disable authentication
}
```

Enable authentication:

```js
const auth = new net.Auth('secretxxx')

server.getAuthenticator = function () {
  return (signature) => auth.verify(signature)
}
```

#### server.address()

Returns the bound address.

#### server.connections: RingPool

##### server.connections.length

Returns the number of concurrent connections on the server.

##### server.connections.next()

Return a socket in turn. Return `null` if no socket available.

#### server.close([callback])

Closes the server.

#### server.listen(...)

Same as node.js `server.listen`

---

### Class toaNet.Client

#### Event: 'close'

#### Event: 'connect'

#### Event: 'auth'

#### Event: 'message'

#### Event: 'drain'

#### Event: 'end'

#### Event: 'error'

#### Event: 'timeout'

#### new toaNet.Client([options])

Creates RPC client.

```js
const client = new net.Client().connect(8000)
```

- `options.retryDelay`: *Optional*, Type: `Number`, Default: `500` ms.
  Sets time interval for reconnection.

- `options.maxAttempts`: *Optional*, Type: `Number`, Default: `50`.
  Sets max attempts for reconnection.

- `options.tcpTimeout`: *Optional*, Type: `Number`, Default: `0`.
  Sets the socket to timeout after timeout milliseconds of inactivity on the socket.

- `options.tcpNoDelay`: *Optional*, Type: `Boolean`, Default: `true`.
  Disables the Nagle algorithm.

- `options.tcpKeepAlive`: *Optional*, Type: `Boolean`, Default: `true`.
  Enable/disable keep-alive functionality, and optionally set the initial delay before the first keepalive probe is sent on an idle socket.

#### client.connect(...)

Same as node.js `socket.connect`

```js
client.connect('tcp://127.0.0.1:33333')
```

#### client.getSignature()

Abstract method. Should be overridden to enable authentication.

Default:

```js
client.getSignature = function () {
  return '' // Disable authentication
}
```

Enable authentication:

```js
const auth = new net.Auth('secretxxx')

client.getSignature = function () {
  return auth.sign({id: 'example'})
}
```

#### client.request(method[, params])

Creates a JSON-RPC 2.0 request to another side. Returns thunk function.

```js
client.request('echo', {name: 'zensh'})((err, res) => {
  console.log(err, res)
})
```

1. `method`: *Required*, Type: `String`.
1. `params`: *Optional*, Type: `Object|Array`.

#### client.notification(method[, params])

Creates a JSON-RPC 2.0 notification to another side. No return.

```js
client.notification('hello', {name: 'zensh'})
```

1. `method`: *Required*, Type: `String`.
1. `params`: *Optional*, Type: `Object|Array`.

#### client.success(id, result)

Respond success result to the request of `id`. No return.

```js
client.success(1, 'OK')
```

1. `id`: *Required*, Type: `String|Integer`, the request's `id`.
1. `result`: *Required*, Type: `Mixed`.

#### client.error(id, error)

Respond error to the request of `id`. No return.

```js
client.error(1, new Error('some error'))
```

1. `id`: *Required*, Type: `String|Integer`, the request's `id`.
1. `error`: *Required*, Type: `Error`.

#### client.createError(error[, code, data])

#### client.createError(message[, code, data])

#### client.createError(code[, data])

#### client.throw(error[, code, data])

#### client.throw(message[, code, data])

#### client.throw(code[, data])

#### client.handleJsonRpc(jsonRpc, handleFn)

#### client.address()

#### client.destroy()

#### client\[Symbol.iterator\]()

---

### Class toaNet.Auth

#### new toaNet.Auth(options)

Creates auth object for Server and Client.

```js
const auth = new net.Auth({
  expiresIn: 3600,
  secrets: ['secretxxx1', 'secretxxx2', 'secretxxx3']
})
```

1. `options.secrets`: *Required*, Type: `String` or a `Array` of string.
1. `options.expiresIn`: *Optional*, Type: `Number`, Default: `3600` seconds.
1. `options.algorithm`: *Optional*, Type: `String`, Default: `'HS256'`.

#### auth.sign(payload)

Returns a new signature string.

```js
let signature = auth.sign({id: 'xxxxxxId'})
```

#### auth.verify(signature)

Verify the signature, return payload object if success, or throw a error.

```js
let session = auth.verify(signature)
```

#### auth.decode(signature)

Try decode the signature, return payload object if success, or `null`.

```js
let signature = auth.decode(signature)
```

---

## Advance API

### Class toaNet.Resp

### Class toaNet.Queue

### Class toaNet.Socket

### Class toaNet.RingPool

### Class toaNet.RPCCommand

### toaNet.jsonrpc

## License

Toa-net is licensed under the [MIT](https://github.com/toajs/toa-net/blob/master/LICENSE) license.
Copyright &copy; 2016-2018 Toajs.

[npm-url]: https://npmjs.org/package/toa-net
[npm-image]: http://img.shields.io/npm/v/toa-net.svg

[travis-url]: https://travis-ci.org/toajs/toa-net
[travis-image]: http://img.shields.io/travis/toajs/toa-net.svg

[downloads-url]: https://npmjs.org/package/toa-net
[downloads-image]: http://img.shields.io/npm/dm/toa-net.svg?style=flat-square
