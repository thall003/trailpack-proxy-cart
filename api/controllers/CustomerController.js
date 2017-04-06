/* eslint no-console: [0] */
'use strict'

const Controller = require('trails/controller')
const lib = require('../../lib')
const Errors = require('proxy-engine-errors')
/**
 * @module CustomerController
 * @description Customer Controller.
 */
// TODO lock down certain requests by Owner(s)
module.exports = class CustomerController extends Controller {
  /**
   *
   * @param req
   * @param res
   */
  count(req, res){
    const ProxyEngineService = this.app.services.ProxyEngineService
    ProxyEngineService.count('Customer')
      .then(count => {
        const counts = {
          customers: count
        }
        return res.json(counts)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }

  /**
   *
   * @param req
   * @param res
   */
  session(req, res) {
    if (!req.customer) {
      return res.sendStatus(401)
    }
    return res.json(req.customer)
  }

  /**
   *
   * @param req
   * @param res
   */
  findById(req, res){
    const orm = this.app.orm
    const Customer = orm['Customer']
    let id = req.params.id
    if (!id && req.customer) {
      id = req.customer.id
    }
    Customer.findByIdDefault(id, {})
      .then(customer => {
        if (!customer) {
          throw new Errors.FoundError(Error(`Customer id ${id} not found`))
        }
        return res.json(customer)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }

  /**
   *
   * @param req
   * @param res
   */
  findAll(req, res){
    const orm = this.app.orm
    const Customer = orm['Customer']
    const limit = req.query.limit || 10
    const offset = req.query.offset || 0
    const sort = req.query.sort || 'created_at DESC'
    const where = this.app.services.ProxyCartService.jsonCritera(req.query.where)

    Customer.findAndCount({
      order: sort,
      offset: offset,
      limit: limit,
      where: where
    })
      .then(customers => {
        res.set('X-Pagination-Total', customers.count)
        res.set('X-Pagination-Pages', Math.ceil(customers.count / limit))
        res.set('X-Pagination-Page', offset == 0 ? 1 : Math.round(offset / limit))
        res.set('X-Pagination-Limit', limit)
        res.set('X-Pagination-Sort', sort)
        return res.json(customers.rows)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }
  /**
   *
   * @param req
   * @param res
   */
  create(req, res) {

    if (req.user && !req.body.owners) {
      req.body.owners = [req.user]
    }

    const CustomerService = this.app.services.CustomerService
    lib.Validator.validateCustomer(req.body)
      .then(values => {
        return CustomerService.create(req.body)
      })
      .then(customer => {
        return new Promise((resolve,reject) => {
          req.loginCustomer(customer, function (err) {
            if (err) {
              return reject(err)
            }
            return resolve(customer)
          })
        })
      })
      .then(customer => {
        // console.log('Customer Request', req.customer)
        return res.json(customer)
      })
      .catch(err => {
        // console.log('CustomerController.create', err)
        return res.serverError(err)
      })

  }

  /**
   *
   * @param req
   * @param res
   */
  update(req, res) {
    const CustomerService = this.app.services.CustomerService
    let id = req.params.id
    if (!id && req.customer) {
      id = req.customer.id
    }
    lib.Validator.validateCustomer(req.body)
      .then(values => {
        req.body.id = id
        return CustomerService.update(req.body)
      })
      .then(customer => {
        return res.json(customer)
      })
      .catch(err => {
        // console.log('CustomerController.update', err)
        return res.serverError(err)
      })
  }

  /**
   * upload CSV
   * @param req
   * @param res
   */
  uploadCSV(req, res) {
    const CustomerCsvService = this.app.services.CustomerCsvService
    const csv = req.file

    if (!csv) {
      const err = new Error('File failed to upload')
      return res.serverError(err)
    }

    CustomerCsvService.customerCsv(csv.path)
      .then(result => {
        return res.json({
          file: req.file,
          result: result
        })
      })
      .catch(err => {
        return res.serverError(err)
      })
  }

  /**
   *
   * @param req
   * @param res
   */
  processUpload(req, res) {
    const CustomerCsvService = this.app.services.CustomerCsvService
    CustomerCsvService.processCustomerUpload(req.params.id)
      .then(result => {
        return res.json(result)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }
  /**
   *
   * @param req
   * @param res
   */
  exportCustomers(req, res) {
    //
  }

  /**
   *
   * @param req
   * @param res
   */
  login(req, res) {
    let customerId = req.params.id
    const Customer = this.app.orm['Customer']

    if (!customerId && req.user) {
      customerId = req.user.current_customer_id
    }

    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }

    Customer.findById(customerId)
      .then(customer => {
        if (!customer) {
          throw new Error('Unexpected Error while authenticating customer')
        }
        return new Promise((resolve,reject) => {
          req.loginCustomer(customer, function (err) {
            if (err) {
              return reject(err)
            }
            return resolve(customer)
          })
        })
      })
      .then(customer => {
        return res.json(customer)
      })
      .catch(err => {
        // console.log('ProductController.clearCustomer', err)
        return res.serverError(err)
      })
  }

  /**
   *
   * @param req
   * @param res
   */
  switchCustomer(req, res) {
    const customerId = req.params.id
    const Customer = this.app.orm['Customer']
    const User = this.app.orm['User']

    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }
    User.findById(req.user.id)
      .then(user => {
        user.current_customer_id = customerId
        return user.save()
      })
      .then(user => {
        return Customer.findById(customerId)
      })
      .then(customer => {
        return new Promise((resolve, reject) => {
          req.loginCustomer(customer, (err) => {
            if (err) {
              return reject(err)
            }
            return resolve(customer)
          })
        })
      })
      .then(customer => {
        return res.json(customer)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }

  /**
   *
   * @param req
   * @param res
   */
  logout(req, res) {
    req.logoutCustomer()
    res.ok()
  }

  /**
   *
   * @param req
   * @param res
   */
  order(req, res) {
    console.log('I WAS CALLED')
    const Order = this.app.orm['Order']
    let customerId = req.params.id
    if (!customerId && req.user) {
      customerId = req.user.current_customer_id
    }
    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }
    Order.findByIdDefault(req.params.id)
      .then(order => {
        return res.json(order)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }

  /**
   *
   * @param req
   * @param res
   */
  accounts(req, res) {
    const Account = this.app.orm['Account']
    let customerId = req.params.id

    if (!customerId && req.user) {
      customerId = req.user.current_customer_id
    }
    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }

    const limit = req.query.limit || 10
    const offset = req.query.offset || 0
    const sort = req.query.sort || 'created_at DESC'

    Account.findAndCount({
      account: sort,
      where: {
        customer_id: customerId
      },
      offset: offset,
      limit: limit
    })
      .then(accounts => {
        res.set('X-Pagination-Total', accounts.count)
        res.set('X-Pagination-Pages', Math.ceil(accounts.count / limit))
        res.set('X-Pagination-Page', offset == 0 ? 1 : Math.round(offset / limit))
        res.set('X-Pagination-Limit', limit)
        res.set('X-Pagination-Sort', sort)
        return res.json(accounts.rows)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }
  /**
   *
   * @param req
   * @param res
   */
  orders(req, res) {
    const Order = this.app.orm['Order']
    let customerId = req.params.id

    if (!customerId && req.user) {
      customerId = req.user.current_customer_id
    }
    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }

    const limit = req.query.limit || 10
    const offset = req.query.offset || 0
    const sort = req.query.sort || 'created_at DESC'

    Order.findAndCount({
      order: sort,
      where: {
        customer_id: customerId
      },
      offset: offset,
      limit: limit
    })
      .then(orders => {
        res.set('X-Pagination-Total', orders.count)
        res.set('X-Pagination-Pages', Math.ceil(orders.count / limit))
        res.set('X-Pagination-Page', offset == 0 ? 1 : Math.round(offset / limit))
        res.set('X-Pagination-Limit', limit)
        res.set('X-Pagination-Sort', sort)
        return res.json(orders.rows)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }

  /**
   *
   * @param req
   * @param res
   */
  sources(req, res) {
    const Source = this.app.orm['Source']
    let customerId = req.params.id

    if (!customerId && req.user) {
      customerId = req.user.current_customer_id
    }
    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }

    const limit = req.query.limit || 10
    const offset = req.query.offset || 0
    const sort = req.query.sort || 'created_at DESC'

    Source.findAndCount({
      source: sort,
      where: {
        customer_id: customerId
      },
      offset: offset,
      limit: limit
    })
      .then(sources => {
        res.set('X-Pagination-Total', sources.count)
        res.set('X-Pagination-Pages', Math.ceil(sources.count / limit))
        res.set('X-Pagination-Page', offset == 0 ? 1 : Math.round(offset / limit))
        res.set('X-Pagination-Limit', limit)
        res.set('X-Pagination-Sort', sort)
        return res.json(sources.rows)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }

  /**
   *
   * @param req
   * @param res
   */
  subscription(req, res) {
    const Subscription = this.app.orm['Subscription']
    let customerId = req.params.id
    if (!customerId && req.user) {
      customerId = req.user.current_customer_id
    }
    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }
    Subscription.findByIdDefault(req.params.id)
      .then(subscription => {
        return res.json(subscription)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }

  /**
   *
   * @param req
   * @param res
   */
  subscriptions(req, res) {
    // console.log('I WAS CALLED')
    const Subscription = this.app.orm['Subscription']
    let customerId = req.params.id

    if (!customerId && req.user) {
      customerId = req.user.current_customer_id
    }
    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }

    const limit = req.query.limit || 10
    const offset = req.query.offset || 0
    const sort = req.query.sort || 'created_at DESC'

    Subscription.findAndCount({
      subscription: sort,
      where: {
        customer_id: customerId
      },
      offset: offset,
      limit: limit
    })
      .then(subscriptions => {
        res.set('X-Pagination-Total', subscriptions.count)
        res.set('X-Pagination-Pages', Math.ceil(subscriptions.count / limit))
        res.set('X-Pagination-Page', offset == 0 ? 1 : Math.round(offset / limit))
        res.set('X-Pagination-Limit', limit)
        res.set('X-Pagination-Sort', sort)
        return res.json(subscriptions.rows)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }
  updateAccount(req, res) {
    let customerId = req.params.id
    if (!customerId && req.user) {
      customerId = req.user.current_customer_id
    }
    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }
  }
  addSource(req, res) {
    let customerId = req.params.id
    if (!customerId && req.user) {
      customerId = req.user.current_customer_id
    }
    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }
  }
  updateSource(req, res) {
    let customerId = req.params.id
    if (!customerId && req.user) {
      customerId = req.user.current_customer_id
    }
    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }
  }
  removeSource(req, res) {
    let customerId = req.params.id
    if (!customerId && req.user) {
      customerId = req.user.current_customer_id
    }
    if (!customerId && !req.user) {
      const err = new Error('A customer id and a user in session are required')
      return res.serverError(err)
    }
  }
}

