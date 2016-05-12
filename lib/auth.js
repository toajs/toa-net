'use strict'

const jws = require('jws')

class Auth {
  constructor (options) {
    if (!options) throw new Error('Invalid options')
    if (options.secrets) {
      this.secrets = options.secrets
      this.algorithm = options.algorithm
    } else {
      this.secrets = options
    }

    if (!Array.isArray(this.secrets)) this.secrets = [this.secrets]
    if (!this.algorithm) this.algorithm = 'HS256'
  }

  sign (payload) {
    return jws.sign({
      header: {alg: this.algorithm},
      payload: payload,
      secret: this.secrets[0]
    })
  }

  decode (signature) {
    return jws.decode(signature)
  }

  verify (signature) {
    let error = null
    let payload = this.decode(signature).payload
    for (var i = 0, len = this.secrets.length; i < len; i++) {
      try {
        if (jws.verify(signature, this.algorithm, this.secrets[i])) return payload
      } catch (err) {
        error = err
      }
    }
    throw error || new Error('Invalid signature')
  }
}

module.exports = Auth
