'use strict'

const axon = require('axon')
const sock = axon.socket('rep')

sock.connect(3002)

sock.on('message', function (method, reply) {
  reply('pong')
})
