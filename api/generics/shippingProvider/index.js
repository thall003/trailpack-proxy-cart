'use strict'
// const _ = require('lodash')
module.exports = class DefaultShippingProvider {
  constructor(options) {
    this.options = options
  }
  validateAddress(data) {
    return Promise.resolve(data)
  }
  getRate(data) {
    return Promise.resolve({})
  }
  getRates(data) {
    return Promise.resolve([])
  }
}
