/* eslint no-console: [0] */
'use strict'

const Service = require('trails/service')
const Errors = require('proxy-engine-errors')
const _ = require('lodash')
/**
 * @module AccountService
 * @description 3rd Party Account Service
 */
module.exports = class AccountService extends Service {
  resolve(account, options) {
    const Account =  this.app.orm['Account']
    if (account instanceof Account.Instance){
      return Promise.resolve(account)
    }
    else if (account && _.isObject(account) && account.id) {
      return Account.findById(account.id, options)
        .then(resAccount => {
          if (!resAccount) {
            throw new Errors.FoundError(Error(`Account ${account.id} not found`))
          }
          return resAccount
        })
    }
    else if (account && _.isObject(account) && account.gateway && account.customer_id) {
      return Account.findOne({
        where: {
          gateway: account.gateway,
          customer_id: account.customer_id
        }
      }, options)
        .then(resAccount => {
          if (!resAccount) {
            throw new Errors.FoundError(Error(`Account with customer id ${account.customer_id} not found`))
          }
          return resAccount
        })
    }
    else {
      // TODO create proper error
      const err = new Error(`Unable to resolve Account ${account}`)
      return Promise.reject(err)
    }
  }
  resolveSource(source, options) {
    const Source =  this.app.orm['Source']
    if (source instanceof Source.Instance){
      return Promise.resolve(source)
    }
    else if (source && _.isObject(source) && source.id) {
      return Source.findById(source.id, options)
        .then(resSource => {
          if (!resSource) {
            throw new Errors.FoundError(Error(`Source ${source.id} not found`))
          }
          return resSource
        })
    }
    else {
      // TODO create proper error
      const err = new Error(`Unable to resolve Source ${source}`)
      return Promise.reject(err)
    }
  }

  /**
   *
   * @param customer
   * @param paymentDetails
   * @returns {Promise.<*>}
   */
  resolvePaymentDetailsToSources(customer, paymentDetails) {
    return Promise.all(paymentDetails.map(detail => {
      if (detail.token) {
        return this.addSource({
          customer_id: customer.id,
          gateway: detail.gateway
        }, detail.token)
         .then(source => {
           delete detail.token
           detail.source = source.get({ plain: true })
           return detail
         })
         .catch(err => {
           return detail
         })
      }
      else {
        return detail
      }
    }))
  }

  /**
   *
   * @param customer
   * @returns {*}
   */
  getDefaultSource(customer) {
    const Source = this.app.orm['Source']
    return Source.findOne({
      customer_id: customer.id,
      is_default: true
    })
  }

  updateAll(customer) {
    //
  }

  /**
   *
   * @param account
   * @param updates
   * @returns {*|Promise.<TResult>}
   */
  update(account, updates) {
    let resAccount
    return this.resolve(account)
      .then(account => {
        resAccount = account
        let update = {
          foreign_id: resAccount.foreign_id,
          foreign_key: resAccount.foreign_key,
          email: resAccount.email
        }
        // Merge the updates
        update = _.merge(update, updates)
        return this.app.services.PaymentGenericService.updateCustomer(update)
          .then(updatedAccount => {
            resAccount  = _.extend(resAccount, updatedAccount)
            return resAccount.save()
          })
      })
      .then(account => {
        const event = {
          object_id: account.customer_id,
          object: 'customer',
          type: 'account.updated',
          data: account
        }
        this.app.services.ProxyEngineService.publish(event.type, event, {save: true})

        return account
      })
  }

  findAndCreate(account) {
    const Account = this.app.orm['Account']
    let resAccount

    return this.app.services.PaymentGenericService.findCustomer(account)
      .then(serviceCustomer => {
        // Set the default
        const create = {
          customer_id: account.customer_id,
          email: account.email,
          is_default: true,
          gateway: serviceCustomer.gateway,
          foreign_id: serviceCustomer.foreign_id,
          foreign_key: serviceCustomer.foreign_key,
          data: serviceCustomer.data
        }
        return Account.create(create)
          .then(account => {
            resAccount = account
            return this.app.services.PaymentGenericService.getCustomerSources(resAccount)
          })
          .then(accountWithSources => {
            return Promise.all(accountWithSources.sources.map(source => {
              source.customer_id = resAccount.customer_id
              return this.app.orm['Source'].create(source)
                .then(source => {
                  // Track Event
                  const event = {
                    object_id: source.customer_id,
                    object: 'customer',
                    type: 'source.created',
                    data: source
                  }
                  this.app.services.ProxyEngineService.publish(event.type, event, {save: true})

                  return source
                })
            }))
          })
          .then(sources => {
            const event = {
              object_id: resAccount.customer_id,
              object: 'customer',
              type: 'account.created',
              data: resAccount
            }
            this.app.services.ProxyEngineService.publish(event.type, event, {save: true})

            return resAccount
          })
        // return Account.findOrCreate({
        //   where: {
        //     customer_id: account.customer_id,
        //     foreign_id: serviceCustomer.foreign_id,
        //     gateway: serviceCustomer.gateway
        //   },
        //   defaults: create
        // })
      })
  }

  /**
   *
   * @param account
   * @param token
   * @returns {Promise.<TResult>}
   */
  addSource(account, token) {
    const Source = this.app.orm['Source']
    let resAccount
    return this.resolve(account)
      .then(account => {
        if (!account) {
          throw new Error('Account did not resolve')
        }
        resAccount = account
        return this.app.services.PaymentGenericService.createCustomerSource({
          account_foreign_id: resAccount.foreign_id,
          token: token
        })
      })
      .then(serviceCustomerSource => {
        // console.log('cart checkout serviceCustomerSource', serviceCustomerSource)
        serviceCustomerSource.gateway = resAccount.gateway
        serviceCustomerSource.account_id = resAccount.id
        serviceCustomerSource.customer_id = resAccount.customer_id
        serviceCustomerSource.is_default = true
        return Source.create(serviceCustomerSource)
      })
      .then(source => {
        const event = {
          object_id: source.customer_id,
          object: 'customer',
          type: 'source.created',
          data: source
        }
        this.app.services.ProxyEngineService.publish(event.type, event, {save: true})

        return source
      })
  }

  /**
   *
   * @param account
   * @param source
   * @returns {Promise.<TResult>}
   */
  findSource(account, source) {
    // const Source = this.app.orm['Source']
    let resAccount, resSource
    return this.resolve(account)
      .then(account => {
        resAccount = account
        return this.resolveSource(source)
      })
      .then(source => {
        resSource = source
        const find = {
          account_foreign_id: resAccount.foreign_id,
          foreign_id: resSource.foreign_id
        }
        return this.app.services.PaymentGenericService.findCustomerSource(find)
      })
      .then(serviceCustomerSource => {
        resSource = _.extend(resSource, serviceCustomerSource)
        return resSource.save()
      })
  }

  /**
   *
   * @param account
   * @param source
   * @param updates
   * @returns {Promise.<TResult>}
   */
  updateSource(account, source, updates) {
    // const Source = this.app.orm['Source']
    let resAccount, resSource
    return this.resolve(account)
      .then(account => {
        resAccount = account
        return this.resolveSource(source)
      })
      .then(source => {
        resSource = source
        let update = {
          account_foreign_id: resAccount.foreign_id,
          foreign_id: resSource.foreign_id
        }
        update = _.merge(update, updates)
        return this.app.services.PaymentGenericService.updateCustomerSource(update)
      })
      .then(serviceCustomerSource => {
        resSource = _.extend(resSource, serviceCustomerSource)
        return resSource.save()
      })
      .then(source => {
        const event = {
          object_id: source.customer_id,
          object: 'customer',
          type: 'source.updated',
          data: source
        }
        this.app.services.ProxyEngineService.publish(event.type, event, {save: true})

        return source
      })
  }

  removeSource(source) {
    let resSource
    return this.resolveSource(source)
      .then(source => {
        resSource = source
        return this.app.services.PaymentGenericService.removeCustomerSource(source)
      })
      .then(customerSource => {
        return this.app.orm['Source'].destroy({
          where: {
            id: resSource.id
          }
        })
      })
      .then(destroyedSource => {
        const event = {
          object_id: resSource.customer_id,
          object: 'customer',
          type: 'source.removed',
          data: resSource
        }
        this.app.services.ProxyEngineService.publish(event.type, event, {save: true})

        return resSource
      })
  }

  /**
   *
   * @param account
   * @returns {Promise.<TResult>}
   */
  syncSources(account) {
    let resAccount

    return this.resolve(account)
      .then(account => {
        resAccount = account
        return this.app.services.PaymentGenericService.findCustomerSources(account)
      })
      .then(serviceCustomerSources => {
        return Promise.all(serviceCustomerSources.map(source => {
          source.gateway = resAccount.gateway
          source.account_id = resAccount.id
          source.customer_id = resAccount.customer_id
          return this.app.orm['Source'].findOrCreate({
            where: {
              customer_id: source.customer_id,
              account_id: source.account_id,
              foreign_id: source.foreign_id
            },
            defaults: source
          })
        }))
      })
  }
}

