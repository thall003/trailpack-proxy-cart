/* eslint no-console: [0] */
'use strict'

const Service = require('trails/service')
const csvParser = require('babyparse')
const _ = require('lodash')
const shortid = require('shortid')
const fs = require('fs')
const CUSTOMER_UPLOAD = require('../utils/enums').CUSTOMER_UPLOAD

/**
 * @module CustomerCsvService
 * @description Customer Csv Service
 */
module.exports = class CustomerCsvService extends Service {
  /**
   *
   * @param file
   * @returns {Promise}
   */
  customerCsv(file) {
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
          this.csvCustomerRow(results.data[0], uploadID)
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
          ProxyEngineService.count('CustomerUpload', { where: { upload_id: uploadID }})
            .then(count => {
              results.customers = count
              // Publish the event
              ProxyEngineService.publish('customer_upload.complete', results)
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
  csvCustomerRow(row, uploadID) {
    // console.log(row)
    const CustomerUpload = this.app.services.ProxyEngineService.getModel('CustomerUpload')
    const values = _.values(CUSTOMER_UPLOAD)
    const keys = _.keys(CUSTOMER_UPLOAD)
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
          else if (k == 'collections') {
            upload[k] = data.split(',').map(collection => { return collection.trim()})
          }
          else {
            upload[k] = data
          }
        }
      }
    })

    upload.collections = _.map(upload.collections, (collection, index) => {
      return {
        title: collection
      }
    })

    const newCustomer = CustomerUpload.build(upload)
    return newCustomer.save()
  }

  /**
   *
   * @param uploadId
   * @returns {Promise}
   */
  processCustomerUpload(uploadId) {
    return new Promise((resolve, reject) => {
      const CustomerUpload = this.app.services.ProxyEngineService.getModel('CustomerUpload')
      let customersTotal = 0
      CustomerUpload.findAll({
        where: {
          upload_id: uploadId
        }
      })
        .then(customers => {
          return Promise.all(customers.map(customer => {
            // TODO change addresses to objects
            const create = {
              first_name: customer.first_name,
              last_name: customer.last_name,
              phone: customer.phone,
              shipping_address: {},
              billing_address: {},
              collections: customer.collections,
              tags: customer.tags
            }
            _.each(customer.get({plain: true}), (value, key) => {
              if (key.indexOf('shipping_') > -1) {
                const newKey = key.replace('shipping_', '')
                create.shipping_address[newKey] = value
              }
              if (key.indexOf('billing_') > -1) {
                const newKey = key.replace('billing_', '')
                create.billing_address[newKey] = value
              }
            })
            if (create.shipping_address.length == 0) {
              delete create.shipping_address
            }
            if (create.billing_address.length == 0) {
              delete create.billing_address
            }
            // console.log('UPLOAD ADDRESS', create.shipping_address, create.billing_address)
            return this.app.services.CustomerService.create(create)
          }))
        })
        .then(results => {
          customersTotal = results.length
          return CustomerUpload.destroy({where: {upload_id: uploadId }})
        })
        .then(destroyed => {
          return resolve({customers: customersTotal})
        })
        .catch(err => {
          return reject(err)
        })
    })
  }
}

