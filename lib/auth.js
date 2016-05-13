'use strict'

const jws = require('jws')

class Auth {
  constructor (options) {
    if (!options) throw new Error('Invalid options')
    if (options.secrets) {
      this.secrets = options.secrets
      this.algorithm = options.algorithm
      this.expiresIn = options.expiresIn
    } else {
      this.secrets = options
    }

    if (!Array.isArray(this.secrets)) this.secrets = [this.secrets]
    if (!this.secrets[0]) throw new Error('"secrets" required!')
    if (!this.algorithm) this.algorithm = 'HS256'
    if (!(this.expiresIn > 0)) this.expiresIn = 3600 // seconds
  }

  sign (payload) {
    payload = Object.assign({exp: Math.floor(Date.now() / 1000) + this.expiresIn}, payload)
    return jws.sign({
      header: {alg: this.algorithm},
      payload: JSON.stringify(payload),
      secret: this.secrets[0]
    })
  }

  decode (signature) {
    let payload = null

    try {
      let res = jws.decode(signature)
      if (res && res.payload) payload = JSON.parse(res.payload)
    } catch (e) {}
    return payload
  }

  verify (signature) {
    let error = null
    let payload = this.decode(signature)
    if (payload) {
      let exp = payload.exp > 0 ? (payload.exp * 1000) : 0
      if (exp < Date.now()) throw new Error('Expired: ' + new Date(exp))
      for (var i = 0, len = this.secrets.length; i < len; i++) {
        try {
          if (jws.verify(signature, this.algorithm, this.secrets[i])) return payload
        } catch (err) {
          error = err
        }
      }
    }
    throw error || new Error('Invalid signature')
  }
}

module.exports = Auth
