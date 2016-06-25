'use strict'

const ilog = require('ilog')
const net = require('..')
const thunk = require('thunks')()
const auth = new net.Auth('secretxxx')
const client = new net.Client()

client.getSignature = function () {
  return auth.sign({id: 'test'})
}
client.connect(3001, '127.0.0.1')

thunk(function * () {
  yield (done) => client.once('auth', done.bind(null, null))
  ilog.info(`Connected to [${client.socket.remoteAddress}]:${client.socket.remotePort}`)

  let count = 100000
  let finish = 0
  let queue = []
  let cocurrency = 1000
  let time = Date.now()

  while (count--) {
    queue.push(client.request('ping')((_, res) => {
      if (!(finish++ % 1000)) process.stdout.write('.')
    }))
    if (queue.length >= cocurrency) yield queue.shift()
  }
  // wait for all request.
  yield queue
  time = Date.now() - time
  ilog('\nFinished,', cocurrency, 'cocurrency,', time + 'ms,', (100000 / (time / 1000)).toFixed(2) + 'ops/s')

  client.destroy()
})(ilog.error)
