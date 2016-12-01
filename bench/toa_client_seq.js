'use strict'

const ilog = require('ilog')
const net = require('..')
const thunk = require('thunks')()
const auth = new net.Auth('secretxxx')
const client = new net.Client()

// net.useMsgp()

client.getSignature = function () {
  return auth.sign({id: 'test'})
}
client.connect(3001, '127.0.0.1')

thunk(function * () {
  yield (done) => client.once('auth', done.bind(null, null))
  ilog.info(`Connected to [${client.socket.remoteAddress}]:${client.socket.remotePort}`)

  let total = 100000
  let count = total
  let finish = 0
  let time = Date.now()

  while (count--) {
    yield client.request('ping')((_, res) => {
      if (!(finish++ % 1000)) process.stdout.write('.')
    })
  }
  // wait for all request.
  time = Date.now() - time
  ilog('\nFinished,', time + ' ms,',
    (client.socket.bytesWritten / 1000).toFixed(2) + ' kb',
    (total / (time / 1000)).toFixed(2) + ' ops')

  process.exit(0)
})(ilog.error)
