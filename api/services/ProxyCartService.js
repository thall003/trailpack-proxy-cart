/* eslint no-console: [0] */
'use strict'

const Service = require('trails/service')
const csvParser = require('babyparse')
const _ = require('lodash')
// const Errors = require('proxy-engine-errors')
const PRODUCT_UPLOAD = require('../utils/enums').PRODUCT_UPLOAD
const fs = require('fs')
const shortid = require('shortid')
/**
 * @module ProxyCartService
 * @description ProxyCart Service
 */
module.exports = class ProxyCartService extends Service {
  /**
   *
   * @param file
   * @returns {Promise}
   */
  productCsv(file) {
    // TODO validate csv
    console.time('csv')
    const uploadID = shortid.generate()
    const ProxyEngineService = this.app.services.ProxyEngineService

    return new Promise((resolve, reject)=>{
      const options = {
        header: true,
        dynamicTyping: true,
        step: (results, parser) => {
          // console.log(parser)
          // console.log('Row data:', results.data)
          // TODO handle errors
          // console.log('Row errors:', results.errors)
          parser.pause()
          this.csvRow(results.data[0], uploadID)
            .then(row => {
              parser.resume()
            })
            .catch(err => {
              console.log(err)
              parser.resume()
            })
        },
        complete: (results, file) => {
          console.timeEnd('csv')
          // console.log('Parsing complete:', results, file)
          results.upload_id = uploadID
          ProxyEngineService.count('ProductUpload', { where: { upload_id: uploadID }})
            .then(count => {
              results.products = count
              resolve(results)
            })
            // TODO handle this more gracefully
            .catch(err => {
              reject(err)
            })
        },
        error: (err, file) => {
          reject(err)
        }
      }
      const fileString = fs.readFileSync(file, 'utf8')
      // Parse the CSV/TSV
      csvParser.parse(fileString, options)
    })
  }

  /**
   *
   * @param row
   * @param uploadID
   */
  csvRow(row, uploadID) {
    // console.log(row)
    const ProductUpload = this.app.services.ProxyEngineService.getModel('ProductUpload')
    const values = _.values(PRODUCT_UPLOAD)
    const keys = _.keys(PRODUCT_UPLOAD)
    const upload = {
      upload_id: uploadID,
      options: {}
    }

    _.each(row, (data, key) => {
      if (data !== '') {
        const i = values.indexOf(key.replace(/^\s+|\s+$/g, ''))
        const k = keys[i]
        if (i > -1 && k) {
          if (k == 'tags') {
            upload[k] = data.split(',').map(tag => { return tag.trim()})
          }
          else if (k == 'images') {
            upload[k] = data.split(',').map(image => { return image.trim()})
          }
          else if (k == 'images_alt') {
            upload[k] = data.split('|').map(alt => { return alt.trim()})
          }
          else if (k == 'variant_images') {
            upload[k] = data.split(',').map(image => { return image.trim()})
          }
          else if (k == 'variant_images_alt') {
            upload[k] = data.split('|').map(alt => { return alt.trim()})
          }
          else {
            upload[k] = data
          }
        }
        else {
          const optionsReg = new RegExp('^((Option \/).([0-9]).(Name|Value))', 'g')
          const match = optionsReg.exec(key)
          // console.log(match)
          if (typeof match[3] !== 'undefined' && match[4] !== 'undefined') {
            const part = match[4].toLowerCase()
            const index = Number(match[3]) - 1
            // console.log(index, part)
            if (typeof upload.options[index] === 'undefined') {
              upload.options[index] = {name: '', value: ''}
            }
            upload.options[index][part] = data.trim()
          }
        }
      }
    })
    // Handle Options
    upload.options = _.map(upload.options, option => {
      const rectObj = {}
      rectObj[option.name] = option.value
      return rectObj
    })
    upload.images = _.map(upload.images, (image, index) => {
      return {
        src: image,
        alt: upload.images_alt[index]
      }
    })
    delete upload.images_alt
    upload.varinat_images = _.map(upload.variant_images, (image, index) => {
      return {
        src: image,
        alt: upload.varinat_images_alt[index]
      }
    })
    delete upload.variant_images_alt
    const newProduct = ProductUpload.build(upload)
    return newProduct.save()
  }

  /**
   *
   * @param uploadId
   * @returns {Promise}
   */
  processProductUpload(uploadId) {
    return new Promise((resolve, reject) => {
      const ProductUpload = this.app.services.ProxyEngineService.getModel('ProductUpload')
      let productsTotal = 0
      let variantsTotal = 0
      ProductUpload.findAll({
        attributes: ['handle'],
        group: ['handle']
      })
        .then(products => {
          return Promise.all(products.map(product => {
            return this.processProductGroup(product.handle)
          }))
        })
        .then(results => {
          // Calculate the totals created
          _.each(results, result => {
            // console.log(result)
            productsTotal = productsTotal + result.products
            variantsTotal = variantsTotal + result.variants
          })
          return ProductUpload.destroy({where: {upload_id: uploadId }})
        })
        .then(destroyed => {

          resolve({products: productsTotal, variants: variantsTotal })
        })
        .catch(err => {
          return reject(err)
        })
    })
  }
  // TODO
  processProductGroup(handle) {
    return new Promise((resolve, reject) => {
      this.app.log.debug('ProxyCartService.processProductGroup', handle)
      const ProductUpload = this.app.services.ProxyEngineService.getModel('ProductUpload')
      ProductUpload.findAll({where: {handle: handle}})
        .then(products => {
          // Remove Upload Junk
          products = _.map(products, product => {
            return _.omit(product.get({plain: true}), ['id', 'upload_id', 'created_at','updated_at'])
          })
          // Construct Root Product
          const defaultProduct = products.shift()
          // Add Product Variants
          defaultProduct.variants = _.map(products, product => {
            product.images = product.variant_images
            return _.omit(product, ['variant_images'])
          })
          // console.log(defaultProduct)
          // Add the product with it's variants
          return this.app.services.ProductService.addProduct(defaultProduct)
        })
        .then(product => {
          return resolve({products: 1, variants: product.variants.length})
        })
    })
  }
  // TODO
  downloadImage(url) {

  }
  // TODO
  buildImages(imageUrl) {
    return new Promise((resolve, reject) =>{
      let full = imageUrl
      let thumbnail = imageUrl
      let small = imageUrl
      let medium = imageUrl
      let large = imageUrl

      return resolve({
        full: full,
        thumbnail: thumbnail,
        small: small,
        medium: medium,
        large: large
      })
    })
  }
  // TODO
  uploadImage(image) {

  }
  ouncesToGrams(ounces) {
    return ounces * 28.3495231
  }
  poundsToGrams(pounds) {
    return pounds * 16 * 28.3495231
  }
  kilogramsToGrams(kilogram) {
    return kilogram / 1000
  }
  resolveConversion(weight, weightUnit){
    switch (weightUnit) {
    case 'kg':
      return this.kilogramsToGrams(weight)
    case 'oz':
      return this.ouncesToGrams(weight)
    case 'lb':
      return this.poundsToGrams(weight)
    default:
      return weight
    }
  }
}

