'use strict'

const TrailsApp = require('trails')
const assert = require('assert')
const supertest = require('supertest')

before(function(done) {
  this.timeout(5000)

  global.app = new TrailsApp(require('./app'))
  // return global.app.start().catch(global.app.stop)
  global.app.start()
    .then(() => {
      return global.app.orm.Shop.findAll()
    })
    .then(shops => {
      global.app.shopID = shops[0].id
      let products = require('./fixtures/products')
      products = products.map( product => {
        product.shops = [{id: global.app.shopID}]
        return product
      })
      return global.app.services.ProductService.addProducts(products)
    })
    .then(products => {
      products = products.map(product => {
        return product.get({plain: true})
      })
      global.app.shopProducts = products
      done()
    })
    .catch(err => {
      console.log(err)
      global.app.stop(err)
      done(err)
    })
})

after(() => {
  return global.app.stop()
})
