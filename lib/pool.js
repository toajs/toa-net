'use strict'

class RingPool {
  constructor () {
    this.pool = []
    this.pos = -1
  }

  get length () {
    return this.pool.length
  }

  next () {
    this.pos += 1
    if (this.pos >= this.length) this.pos = 0
    return this.pool[this.pos] || null
  }

  add (val) {
    if (!val) throw new TypeError('Invalid object')
    this.pool.push(val)
    return this.length
  }

  remove (val) {
    let index = this.pool.indexOf(val)
    if (index >= 0) {
      this.pool.splice(index, 1)
      if (index <= this.pos) this.pos -= 1
    }
    return this.length
  }

  reset () {
    this.pos = -1
    this.pool.length = 0
  }

  [Symbol.iterator] () {
    return this.pool[Symbol.iterator]()
  }
}

module.exports = RingPool
