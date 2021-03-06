'use strict'

const Service = require('trails/service')
const _ = require('lodash')
const Errors = require('proxy-engine-errors')

/**
 * @module ShopService
 * @description Shop Service
 */
module.exports = class ShopService extends Service {
  resolve(shop, options) {
    if (!options) {
      options = {}
    }
    const Shop =  this.app.orm.Shop
    if (shop instanceof Shop.Instance){
      return Promise.resolve(shop)
    }
    else if (shop && _.isObject(shop) && shop.id) {
      return Shop.findById(shop.id, options)
        .then(resShop => {
          if (!resShop) {
            throw new Errors.FoundError(Error(`Shop ${shop.id} not found`))
          }
          return resShop
        })
    }
    else if (shop && (_.isString(shop) || _.isNumber(shop))) {
      return Shop.findOne({
        where: {
          $or: [
            { id: shop },
            { handle: shop }
          ]
        },
        transaction: options.transaction || null
      })
        .then(resShop => {
          if (!resShop) {
            throw new Errors.FoundError(Error(`Shop ${shop} not found`))
          }
          return resShop
        })
    }
    else {
      return Shop.findOne({
        transaction: options.transaction || null
      })
        .then(resShop => {
          if (!resShop) {
            throw new Errors.FoundError(Error(`Shop ${shop} not found and could not resolve the default`))
          }
          return resShop
        })
      // const err = new Error('Unable to resolve Shop')
      // Promise.reject(err)
    }
  }

  /**
   *
   * @param data
   * @param options
   * @returns {data}
   */
  create(data, options) {
    const Shop = this.app.orm.Shop
    return Shop.create(data, options)
  }
}

