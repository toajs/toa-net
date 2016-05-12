'use strict'
// **Github:** https://github.com/toajs/toa-net
//
// **License:** MIT

const tman = require('tman')
const assert = require('assert')
const toaNet = require('..')

tman.suite('toa-net', function () {
  tman.it('Auth', function () {
    let auth = new toaNet.Auth('secretxxx')
    let signature = auth.sign({id: 'test'})
    console.log(signature)
    console.log(auth.decode(signature))
    console.log(auth.verify(signature))
  })
})
