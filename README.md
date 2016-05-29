Toa-net
====
JSON-RPC 2.0 client/server over TCP net.

[![NPM version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]
[![Downloads][downloads-image]][downloads-url]

## Features

1. Use [JSON-RPC 2.0 Specification](http://www.jsonrpc.org/specification) as RPC protocol.
2. Use [RESP (Redis Serialization Protocol)](http://redis.io/topics/protocol) as message protocol.
3. Use [JSON Web Signatures](http://self-issued.info/docs/draft-ietf-jose-json-web-signature.html) as authentication protocol.
4. Implemented ES6 Iterable protocol.

## Examples

### [Simple](https://github.com/toajs/toa-net/tree/master/example/simple.js)

```js
const net = require('toa-net')
const auth = new net.Auth('secretxxx')
const server = new net.Server(function (socket) {
  console.log(socket.session) // { exp: 1463131669, id: 'example' }

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
}, {auth: auth}).listen(8000)

const client = new net.Client({auth: auth.sign({id: 'example'})}).connect(8000)

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

const server = new net.Server(function (socket) {
  thunk(function * () {
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
  })(() => process.exit(0))
}).listen(8000)

const client = new net.Client().connect(8000)

client.notification('hello', [1])
client.notification('hello', [2])
client.notification('hello', [3])
client.request('echo', {a: 4})((err, res) => {
  console.log(err, res) // null { a: 4 }

  client.destroy()
  server.close()
})
```

## Bench

### Run bench
1. Run server in some where:
```
node bench/server
```
2. Update the server host, Run:
```
node bench/client
```

### 100000 Ping/Pong messages
1. local -> local, no-delay: **1000 cocurrency, 3180ms, 31446ops/s**
2. local -> local, delay 1000ms: **1000 cocurrency, 100590ms, 994ops/s**
3. local -> local, delay 1000ms: **5000 cocurrency, 20869ms, 4791ops/s**
4. local -> local, delay 1000ms: **10000 cocurrency, 11074ms, 9030ops/s**

### 10000 simple messages, 1000 cocurrency
```js
// message
{
  name: 'abcdefghijklmnopqrst',
  email: 'abcdefghijklmnopqrst@test.com',
  location: 'zhangjiang, shanghai, china'
}
```
1. aliyun -> aws: **264321ms, 37ops/s, 4.61kb/s**
2. aws -> aliyun: **82129ms, 121ops/s, 14.84kb/s**
3. aliyun -> proxy_cn -> fiber -> proxy_us -> aws: **8056ms, 1241ops/s, 151.30kb/s**

## Install

```sh
npm install toa-net
```

## API

```js
const toaNet = require('toa-net')
```

### Class toaNet.Server

#### new toaNet.Server(connectionListener[, options])
Create RPC server.

```js
const server = new net.Server(function (socket) {
  socket.on('message', (message) => {
    console.log(message)
  })
}, {auth: auth}).listen(8000)
```

1. `connectionListener`: *Required*, Type: `Function`.
2. `options.auth`: *Optional*, Type: `Auth` instance.

#### Event: 'close'
#### Event: 'error'
#### Event: 'listening'

#### server.address()

#### server.getConnections()

#### server.close([callback])

#### server.listen(...)
Same as node.js `server.listen`

### Class toaNet.Client

#### Event: 'close'
#### Event: 'connect'
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

1. `options.auth`: *Optional*, Type: `Auth` instance.

#### client.connect(...)
Same as node.js `socket.connect`

#### client.request(method[, params])
Creates a JSON-RPC 2.0 request to another side. Returns thunk function.

```js
client.request('echo', {name: 'zensh'})((err, res) => {
  console.log(err, res)
})
```

1. `method`: *Required*, Type: `String`.
2. `params`: *Optional*, Type: `Object|Array`.

#### client.notification(method[, params])
Creates a JSON-RPC 2.0 notification to another side. No return.

```js
client.notification('hello', {name: 'zensh'})
```

1. `method`: *Required*, Type: `String`.
2. `params`: *Optional*, Type: `Object|Array`.

#### client.success(id, result)
Respond success result to the request of `id`. No return.

```js
client.success(1, 'OK')
```

1. `id`: *Required*, Type: `String|Integer`, the request's `id`.
2. `result`: *Required*, Type: `Mixed`.

#### client.error(id, error)
Respond error to the request of `id`. No return.

```js
client.error(1, new Error('some error'))
```

1. `id`: *Required*, Type: `String|Integer`, the request's `id`.
2. `error`: *Required*, Type: `Error`.

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
2. `options.expiresIn`: *Optional*, Type: `Number`, Default: `3600` seconds.
3. `options.algorithm`: *Optional*, Type: `String`, Default: `'HS256'`.

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

## License
Toa-net is licensed under the [MIT](https://github.com/toajs/toa-net/blob/master/LICENSE) license.  
Copyright &copy; 2016 Toajs.

[npm-url]: https://npmjs.org/package/toa-net
[npm-image]: http://img.shields.io/npm/v/toa-net.svg

[travis-url]: https://travis-ci.org/toajs/toa-net
[travis-image]: http://img.shields.io/travis/toajs/toa-net.svg

[downloads-url]: https://npmjs.org/package/toa-net
[downloads-image]: http://img.shields.io/npm/dm/toa-net.svg?style=flat-square
