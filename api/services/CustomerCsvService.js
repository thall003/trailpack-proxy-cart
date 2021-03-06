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
          return this.csvCustomerRow(results.data[0], uploadID)
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
              return resolve(results)
            })
            // TODO handle this more gracefully
            .catch(err => {
              return reject(err)
            })
        },
        error: (err, file) => {
          return reject(err)
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
    const CustomerUpload = this.app.orm.CustomerUpload
    const values = _.values(CUSTOMER_UPLOAD)
    const keys = _.keys(CUSTOMER_UPLOAD)
    const upload = {
      upload_id: uploadID,
      options: {}
    }

    _.each(row, (data, key) => {
      if (data === '') {
        row[key] = null
      }
    })

    row = _.omitBy(row, _.isNil)

    if (_.isEmpty(row)) {
      return Promise.resolve({})
    }

    _.each(row, (data, key) => {
      if (data !== '') {
        const i = values.indexOf(key.replace(/^\s+|\s+$/g, ''))
        const k = keys[i]
        if (i > -1 && k) {
          if (k == 'tags') {
            upload[k] = _.uniq(data.toLowerCase().split(',').map(tag => { return tag.trim()}))
          }
          else if (k == 'collections') {
            upload[k] = data.split(',').map(collection => { return collection.trim()})
          }
          else if (k == 'accounts') {
            upload[k] = data.split(',').map(account => { return account.trim()})
          }
          else if (k == 'users') {
            upload[k] = data.split(',').map(user => { return user.trim()})
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
    upload.accounts = _.map(upload.accounts, (account, index) => {
      return {
        gateway: account.split(/:(.+)/)[0],
        foreign_id: account.split(/:(.+)/)[1]
      }
    })
    upload.users = _.map(upload.users, (user, index) => {
      return {
        email: user
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
    const CustomerUpload = this.app.orm.CustomerUpload
    const errors = []
    let customersTotal = 0

    return CustomerUpload.batch({
      where: {
        upload_id: uploadId
      }
    }, (customers) => {

      const Sequelize = this.app.orm.Customer.sequelize
      return Sequelize.Promise.mapSeries(customers, customer => {
        const create = {
          account_balance: customer.account_balance,
          first_name: customer.first_name,
          last_name: customer.last_name,
          email: customer.email,
          company: customer.company,
          phone: customer.phone,
          shipping_address: {},
          billing_address: {},
          collections: customer.collections,
          tags: customer.tags,
          accounts: customer.accounts,
          users: customer.users
        }
        _.each(customer.get({plain: true}), (value, key) => {
          if (key.indexOf('shipping_') > -1) {
            const newKey = key.replace('shipping_', '')
            if (value && value != '') {
              create.shipping_address[newKey] = value
            }
          }
          if (key.indexOf('billing_') > -1) {
            const newKey = key.replace('billing_', '')
            if (value && value != '') {
              create.billing_address[newKey] = value
            }
          }
        })
        if (_.isEmpty(create.shipping_address)) {
          delete create.shipping_address
        }
        if (_.isEmpty(create.billing_address)) {
          delete create.billing_address
        }
        // console.log('UPLOAD ADDRESS', create.shipping_address, create.billing_address)
        return this.app.services.CustomerService.create(create)
          .then(() => {
            customersTotal++
            return
          })
          .catch(err => {
            errors.push(err.message)
            return
          })
      })
        .then(() => {
          return CustomerUpload.destroy({where: {upload_id: uploadId}})
            .catch(err => {
              errors.push(err.message)
              return
            })
        })
        .then(() => {
          const results = {
            upload_id: uploadId,
            customers: customersTotal,
            errors: errors
          }
          this.app.services.ProxyEngineService.publish('customer_process.complete', results)
          return results
        })
    })
  }
}

