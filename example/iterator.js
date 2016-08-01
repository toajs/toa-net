'use strict'
// **Github:** https://github.com/toajs/toa-net
//
// **License:** MIT

const thunk = require('thunks')()
const net = require('..')

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
