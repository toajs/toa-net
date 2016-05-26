'use strict'

const ilog = require('ilog')
const net = require('..')
const thunk = require('thunks')()
const auth = new net.Auth('secretxxx')
const client = new net.Client({auth: auth.sign({id: 'test'})})

ilog.info('Client start')
client.connect(3001, '127.0.0.1')

thunk(function * () {
  yield (done) => client.once('connect', done)
  ilog.info('Client connected')

  let index = 0
  let len = 0
  let queue = []
  let cocurrency = 1000
  let time = Date.now()
  let job = {
    name: 'abcdefghijklmnopqrst',
    email: 'abcdefghijklmnopqrst@test.com',
    location: 'zhangjiang, shanghai, china'
  }

  while (index < 100000) {
    let id = ++index
    let message = Object.assign({id: id}, job)
    len += JSON.stringify(message).length

    queue.push(client.request('test', message)((_, res) => {
      if (!(res % 100)) ilog.info(res)
    }))

    if (queue.length >= cocurrency) yield queue.shift()
  }
  // wait for all request.
  yield queue
  time = Date.now() - time
  console.log('\nFinished,', cocurrency, 'cocurrency,', time, 'ms,', (100000 / (time / 1000)).toFixed(2), 'ops/s,', (len / time).toFixed(2), 'kb/s')

  client.destroy()
})(ilog.error)
