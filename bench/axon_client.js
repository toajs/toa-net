'use strict'

const ilog = require('ilog')
const thunk = require('thunks')()
const axon = require('axon')
const sock = axon.socket('req')

sock.connect(3002)

function request (method) {
  return thunk(function (done) {
    sock.send(method, (res) => done(null, res))
  })
}

thunk(function * () {
  yield (done) => sock.on('connect', () => done())

  ilog.info('Connected to 3002')

  let total = 5000000
  let count = total
  let finish = 0
  let queue = []
  let cocurrency = 1000
  let time = Date.now()

  while (count--) {
    queue.push(request('ping')((_, res) => {
      if (!(finish++ % 10000)) process.stdout.write('.')
    }))
    if (queue.length >= cocurrency) yield queue.shift()
  }
  // wait for all request.
  yield queue
  time = Date.now() - time
  ilog('\nFinished,', cocurrency + ' cocurrency,', time + ' ms,',
    (sock.socks[0].bytesWritten / 1000).toFixed(2) + ' kb',
    (total / (time / 1000)).toFixed(2) + ' ops')

  process.exit(0)
})(ilog.error)
