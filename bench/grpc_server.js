'use strict'

const path = require('path')
const grpc = require('grpc')
const pingpong = grpc.load(path.join(__dirname, 'grpc.proto')).pingpong
const server = new grpc.Server()

server.addProtoService(pingpong.PingPong.service, {ping: pong})
server.bind('0.0.0.0:3002', grpc.ServerCredentials.createInsecure())
server.start()

function pong (call, callback) {
  callback(null, {result: 'Pong'})
}
