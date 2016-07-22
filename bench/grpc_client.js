'use strict'

const path = require('path')
const grpc = require('grpc')
const ilog = require('ilog')
const thunk = require('thunks')()
const pingpong = grpc.load(path.join(__dirname, 'grpc.proto')).pingpong
const client = new pingpong.PingPong('localhost:3002', grpc.credentials.createInsecure())

function request (params) {
  return thunk((done) => client.ping(params, done))
}

thunk(function * () {
  yield (done) => grpc.waitForClientReady(client, Infinity, done)
  ilog.info('Connected to localhost:3002')

  let total = 5000000
  let count = total
  let finish = 0
  let queue = []
  let cocurrency = 1000
  let time = Date.now()

  while (count--) {
    queue.push(request({method: 'Ping'})((_, res) => {
      if (!(finish++ % 10000)) process.stdout.write('.')
    }))
    if (queue.length >= cocurrency) yield queue.shift()
  }
  // wait for all request.
  yield queue
  time = Date.now() - time
  ilog('\nFinished,', cocurrency + ' cocurrency,', time + ' ms,',
    (total / (time / 1000)).toFixed(2) + ' ops')

  process.exit(0)
})(ilog.error)
