/* eslint new-cap: [0] */
/* eslint no-console: [0] */
'use strict'

const Model = require('trails/model')
const helpers = require('proxy-engine-helpers')
const Errors = require('proxy-engine-errors')
const _ = require('lodash')
const shortid = require('shortid')
const queryDefaults = require('../utils/queryDefaults')
const ORDER_STATUS = require('../utils/enums').ORDER_STATUS
const ORDER_CANCEL = require('../utils/enums').ORDER_CANCEL
const ORDER_FINANCIAL = require('../utils/enums').ORDER_FINANCIAL
const TRANSACTION_STATUS = require('../utils/enums').TRANSACTION_STATUS
const TRANSACTION_KIND = require('../utils/enums').TRANSACTION_KIND
const ORDER_FULFILLMENT = require('../utils/enums').ORDER_FULFILLMENT
const ORDER_FULFILLMENT_KIND = require('../utils/enums').ORDER_FULFILLMENT_KIND
const FULFILLMENT_STATUS = require('../utils/enums').FULFILLMENT_STATUS
const PAYMENT_PROCESSING_METHOD = require('../utils/enums').PAYMENT_PROCESSING_METHOD


/**
 * @module Order
 * @description Order Model
 */
module.exports = class Order extends Model {

  static config (app, Sequelize) {
    let config = {}
    if (app.config.database.orm === 'sequelize') {
      config = {
        options: {
          autoSave: true,
          underscored: true,
          defaultScope: {
            where: {
              live_mode: app.config.proxyEngine.live_mode
            }
          },
          scopes: {
            open: {
              where: {
                status: ORDER_STATUS.OPEN
              }
            },
            closed: {
              where: {
                status: ORDER_STATUS.CLOSED
              }
            }
          },
          hooks: {
            beforeCreate: (values, options, fn) => {
              if (values.ip) {
                values.create_ip = values.ip
              }
              if (!values.token) {
                values.token = `order_${shortid.generate()}`
              }
              fn()
            },
            beforeUpdate: (values, options, fn) => {
              if (values.ip) {
                values.update_ip = values.ip
              }
              if (values.changed('status') && values.status == ORDER_STATUS.CLOSED) {
                values.close()
              }
              fn()
            },

            // Will not save updates from hooks!
            afterUpdate: (values, options, fn) => {
              app.services.OrderService.afterUpdate(values, options)
                .then(values => {
                  return fn(null, values)
                })
                .catch(err => {
                  return fn(err)
                })
            },
            afterCreate: (values, options, fn) => {
              app.services.OrderService.afterCreate(values, options)
                .then(values => {
                  return values.save()
                })
                .then(values => {
                  return fn(null, values)
                })
                .catch(err => {
                  return fn(err)
                })
            }
          },
          classMethods: {
            ORDER_STATUS: ORDER_STATUS,
            ORDER_CANCEL: ORDER_CANCEL,
            ORDER_FINANCIAL: ORDER_FINANCIAL,
            ORDER_FULFILLMENT: ORDER_FULFILLMENT,
            ORDER_FULFILLMENT_KIND: ORDER_FULFILLMENT_KIND,
            PAYMENT_PROCESSING_METHOD: PAYMENT_PROCESSING_METHOD,
            TRANSACTION_STATUS: TRANSACTION_STATUS,
            TRANSACTION_KIND: TRANSACTION_KIND,
            FULFILLMENT_STATUS: FULFILLMENT_STATUS,
            /**
             * Associate the Model
             * @param models
             */
            associate: (models) => {
              // The individual items of this order
              models.Order.hasMany(models.OrderItem, {
                as: 'order_items',
                foreignKey: 'order_id'
              })
              // The fulfillments for this order
              models.Order.hasMany(models.Fulfillment, {
                as: 'fulfillments',
                foreignKey: 'order_id'
              })
              // The transactions for this order
              models.Order.hasMany(models.Transaction, {
                as: 'transactions',
                foreignKey: 'order_id'
              })
              // The list of refunds applied to the order.
              models.Order.hasMany(models.Refund, {
                as: 'refunds',
                foreignKey: 'order_id'
              })
              // Applicable discount codes that can be applied to the order. If no codes exist the value will default to blank.
              models.Order.belongsToMany(models.Discount, {
                as: 'discount_codes',
                through: {
                  model: models.ItemDiscount,
                  unique: false,
                  scope: {
                    model: 'order'
                  }
                },
                foreignKey: 'model_id',
                constraints: false
              })
              // The tags added to this order
              models.Order.belongsToMany(models.Tag, {
                as: 'tags',
                through: {
                  model: models.ItemTag,
                  unique: false,
                  scope: {
                    model: 'order'
                  }
                },
                foreignKey: 'model_id',
                constraints: false
              })
              // The payment source used to pay this order
              models.Order.belongsToMany(models.Source, {
                as: 'sources',
                through: {
                  model: models.OrderSource,
                  unique: false
                },
                foreignKey: 'order_id',
                constraints: false
              })
              // The events tied to this order
              models.Order.hasMany(models.Event, {
                as: 'events',
                foreignKey: 'object_id',
                scope: {
                  object: 'order'
                },
                constraints: false
              })
              models.Order.hasOne(models.Cart, {
                foreignKey: 'order_id'
              })
              models.Order.hasOne(models.Customer, {
                foreignKey: 'last_order_id'
              })
            },
            findByIdDefault: function(id, options) {
              options = options || {}
              options = _.defaultsDeep(options, queryDefaults.Order.default(app))
              return this.findById(id, options)
            },
            findAndCountDefault: function(options) {
              options = options || {}
              options = _.defaultsDeep(options, queryDefaults.Order.default(app))
              return this.findAndCount(options)
            },
            /**
             *
             * @param order
             * @param options
             * @returns {*}
             */
            resolve: function(order, options){
              options = options || {}
              const Order =  this
              if (order instanceof Order.Instance){
                return Promise.resolve(order)
              }
              else if (order && _.isObject(order) && order.id) {
                return Order.findByIdDefault(order.id, options)
                  .then(resOrder => {
                    if (!resOrder) {
                      throw new Errors.FoundError(Error(`Order ${order.id} not found`))
                    }
                    return resOrder
                  })
              }
              else if (order && (_.isString(order) || _.isNumber(order))) {
                return Order.findByIdDefault(order, options)
                  .then(resOrder => {
                    if (!resOrder) {
                      throw new Errors.FoundError(Error(`Order ${order} not found`))
                    }
                    return resOrder
                  })
              }
              else {
                // TODO create proper error
                const err = new Error('Unable to resolve Order')
                Promise.reject(err)
              }
            }
          },
          instanceMethods: {
            toJSON: function() {
              // Make JSON
              const resp = this.get({ plain: true })

              // Transform Tags to array on toJSON
              if (resp.tags) {
                // console.log(resp.tags)
                resp.tags = resp.tags.map(tag => {
                  if (tag && _.isString(tag)) {
                    return tag
                  }
                  else if (tag && tag.name && tag.name !== '') {
                    return tag.name
                  }
                })
              }
              return resp
            },
            cancel(options) {
              options = options || {}
              this.cancelled_at = new Date(Date.now())
              this.status = ORDER_STATUS.CLOSED
              this.closed_at = this.cancelled_at
              this.cancel_reason = options.cancel_reason
              return this
            },
            close() {
              this.status = ORDER_STATUS.CLOSED
              this.closed_at = new Date(Date.now())
              return this
            },
            saveFinancialStatus: function(options) {
              options = options || {}
              let currentStatus, previousStatus
              // If not a persisted instance
              if (!this.id) {
                return Promise.resolve(this)
              }
              return Promise.resolve()
                .then(() => {
                  if (!this.transactions) {
                    return this.getTransactions()
                  }
                  else {
                    return this.transactions
                  }
                })
                .then(transactions => {
                  transactions = transactions || []
                  this.set('transactions', transactions)
                  this.setFinancialStatus()

                  if (this.changed('financial_status')) {
                    currentStatus = this.financial_status
                    previousStatus = this.previous('financial_status')
                  }
                  return this.save()
                })
                .then(() => {
                  if (currentStatus && previousStatus) {
                    const event = {
                      object_id: this.id,
                      object: 'order',
                      objects: [{
                        customer: this.customer_id
                      },{
                        order: this.id
                      }],
                      type: `order.financial_status.${currentStatus}`,
                      message: `Order ${ this.name || 'ID ' + this.id } financial status changed from "${previousStatus}" to "${currentStatus}"`,
                      data: this
                    }
                    return app.services.ProxyEngineService.publish(event.type, event, {save: true})
                  }
                  else {
                    return
                  }
                })
                .then(() => {
                  if (currentStatus === ORDER_FINANCIAL.PAID && previousStatus !== ORDER_FINANCIAL.PAID) {
                    return this.attemptImmediate()
                  }
                  else {
                    return this
                  }
                })
                .then(() => {
                  return this
                })
            },
            saveFulfillmentStatus: function() {
              let currentStatus, previousStatus
              // If not a persisted instance return right away
              if (!this.id) {
                return Promise.resolve(this)
              }
              return Promise.resolve()
                .then(() => {
                  if (!this.order_items) {
                    return this.getOrder_items()
                  }
                  else {
                    return this.order_items
                  }
                })
                .then(orderItems => {
                  orderItems = orderItems || []
                  this.set('order_items', orderItems)

                  if (!this.fulfillments) {
                    return this.getFulfillments({
                      include: [
                        {
                          model: app.orm['OrderItem'],
                          as: 'order_items'
                        }
                      ]
                    })
                  }
                  else {
                    return this.fulfillments
                  }
                })
                .then(fulfillments => {
                  fulfillments = fulfillments || []
                  this.set('fulfillments', fulfillments)
                  this.setFulfillmentStatus()

                  if (this.changed('fulfillment_status')) {
                    currentStatus = this.fulfillment_status
                    previousStatus = this.previous('fulfillment_status')
                  }
                  return this.save()
                })
                .then(() => {
                  if (currentStatus && previousStatus) {
                    const event = {
                      object_id: this.id,
                      object: 'order',
                      objects: [{
                        customer: this.customer_id
                      },{
                        order: this.id
                      }],
                      type: `order.fulfillment_status.${currentStatus}`,
                      message: `Order ${ this.name || 'ID ' + this.id } fulfilment status changed from "${previousStatus}" to "${currentStatus}"`,
                      data: this
                    }
                    return app.services.ProxyEngineService.publish(event.type, event, {save: true})
                  }
                  else {
                    return
                  }
                })
                .then(() => {
                  return this
                })
            },
            setFinancialStatus: function(){
              if (!this.transactions) {
                throw new Error('Order.setFinancialStatus requires transactions to be populated')
                // return Promise.reject(err)
              }

              const pending = this.transactions.filter(transaction => [
                TRANSACTION_STATUS.PENDING,
                TRANSACTION_STATUS.FAILURE,
                TRANSACTION_STATUS.ERROR
              ].indexOf(transaction.status ) > -1)

              const cancelled = this.transactions.filter(transaction => [
                TRANSACTION_STATUS.CANCELLED
              ].indexOf(transaction.status ) > -1)

              const successes = this.transactions.filter(transaction => [
                TRANSACTION_STATUS.SUCCESS
              ].indexOf(transaction.status ) > -1)

              let financialStatus = ORDER_FINANCIAL.PENDING
              // TRANSACTION STATUS pending, failure, success or error
              // TRANSACTION KIND authorize, capture, sale, refund, void

              let totalAuthorized = 0
              let totalVoided  = 0
              let totalSale = 0
              let totalRefund = 0
              let totalCancelled = 0
              let totalPending = 0

              // Calculate the totals of the successful transactions
              _.each(successes, transaction => {
                if (transaction.kind == TRANSACTION_KIND.AUTHORIZE) {
                  totalAuthorized = totalAuthorized + transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.VOID) {
                  totalVoided = totalVoided + transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.CAPTURE) {
                  totalSale = totalSale + transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.SALE) {
                  totalSale = totalSale + transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.REFUND) {
                  totalRefund = totalRefund + transaction.amount
                }
              })

              // Calculate the totals of pending transactions
              _.each(pending, transaction => {
                if (transaction.kind == TRANSACTION_KIND.AUTHORIZE) {
                  totalPending = totalPending + transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.CAPTURE) {
                  totalPending = totalPending + transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.SALE) {
                  totalPending = totalPending + transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.VOID) {
                  totalPending = totalPending - transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.REFUND) {
                  totalPending = totalPending - transaction.amount
                }
              })

              // Calculate the totals of pending transactions
              _.each(cancelled, transaction => {
                if (transaction.kind == TRANSACTION_KIND.AUTHORIZE) {
                  totalCancelled = totalCancelled + transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.CAPTURE) {
                  totalCancelled = totalCancelled + transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.SALE) {
                  totalCancelled = totalCancelled + transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.VOID) {
                  totalCancelled = totalCancelled - transaction.amount
                }
                else if (transaction.kind == TRANSACTION_KIND.REFUND) {
                  totalCancelled = totalCancelled - transaction.amount
                }
              })

              // If this item is completely free
              if (this.total_price == 0) {
                financialStatus = ORDER_FINANCIAL.PAID
              }
              // Total Authorized is the Price of the Order and there are no Capture/Sale transactions and 0 voided
              else if (totalAuthorized == this.total_price && totalSale == 0 && totalVoided == 0 && totalRefund == 0) {
                // console.log('SHOULD BE: authorized')
                financialStatus = ORDER_FINANCIAL.AUTHORIZED
              }
              // Total Authorized is the Price of the Order and there are no Capture/Sale transactions
              else if (totalAuthorized == totalVoided && totalVoided > 0) {
                // console.log('SHOULD BE: voided')
                financialStatus = ORDER_FINANCIAL.VOIDED
              }
              else if (this.total_price == totalVoided && totalVoided > 0) {
                // console.log('SHOULD BE: voided')
                financialStatus = ORDER_FINANCIAL.VOIDED
              }
              // Total Sale is the Price of the order and there are no refunds
              else if (totalSale == this.total_price && totalRefund == 0) {
                // console.log('SHOULD BE: paid')
                financialStatus = ORDER_FINANCIAL.PAID
              }
              // Total Sale is not yet the Price of the order and there are no refunds
              else if (totalSale < this.total_price && totalSale > 0 && totalRefund == 0) {
                // console.log('SHOULD BE: partially_paid')
                financialStatus = ORDER_FINANCIAL.PARTIALLY_PAID
              }
              // Total Sale is the Total Price and Total Refund is Total Price
              else if (this.total_price ==  totalRefund) {
                // console.log('SHOULD BE: refunded')
                financialStatus = ORDER_FINANCIAL.REFUNDED
              }
              // Total Sale is the Total Price but Total Refund is less than the Total Price
              else if (totalRefund < this.total_price && totalRefund > 0) {
                // console.log('SHOULD BE: partially_refunded')
                financialStatus = ORDER_FINANCIAL.PARTIALLY_REFUNDED
              }

              app.log.debug(`FINANCIAL Status: ${financialStatus}, Sales: ${totalSale}, Authorized: ${totalAuthorized}, Refunded: ${totalRefund}, Pending: ${totalPending}`)
              // pending: The finances are pending. (This is the default value.)
              // authorized: The finances have been authorized.
              // partially_paid: The finances have been partially paid.
              // paid: The finances have been paid.
              // partially_refunded: The finances have been partially refunded.
              // refunded: The finances have been refunded.
              // voided: The finances have been voided.
              this.financial_status = financialStatus
              this.total_authorized = totalAuthorized
              this.total_captured = totalSale
              this.total_refunds = totalRefund
              this.total_voided = totalVoided
              this.total_cancelled = totalCancelled
              this.total_pending = totalPending
              this.total_due = this.total_price - totalSale
              return this
            },
            setFulfillmentStatus: function(){
              if (!this.fulfillments) {
                throw new Error('Order.setFulfillmentStatus requires fulfillments to be populated')
                // return Promise.reject(err)
              }
              if (!this.order_items) {
                throw new Error('Order.setFulfillmentStatus requires order_items to be populated')
                // return Promise.reject(err)
              }

              let fulfillmentStatus = ORDER_FULFILLMENT.NONE
              let totalFulfillments = 0
              let totalPartialFulfillments = 0
              let totalSentFulfillments = 0
              let totalNonFulfillments = 0
              let totalCancelledFulfillments = 0

              this.fulfillments.forEach(fulfilment => {
                if (fulfilment.status == FULFILLMENT_STATUS.FULFILLED) {
                  totalFulfillments++
                }
                else if (fulfilment.status == FULFILLMENT_STATUS.PARTIAL) {
                  totalPartialFulfillments++
                }
                else if (fulfilment.status == FULFILLMENT_STATUS.SENT) {
                  totalSentFulfillments++
                }
                else if (fulfilment.status == FULFILLMENT_STATUS.NONE) {
                  totalNonFulfillments++
                }
                else if (fulfilment.status == FULFILLMENT_STATUS.CANCELLED) {
                  totalCancelledFulfillments++
                }
              })

              // this.order_items.forEach(item => {
              //   if (!item.fulfillment_id) {
              //     totalNonFulfillments++
              //   }
              // })

              if (totalFulfillments == this.fulfillments.length && this.fulfillments.length > 0) {
                fulfillmentStatus = ORDER_FULFILLMENT.FULFILLED
              }
              else if (totalSentFulfillments == this.fulfillments.length && this.fulfillments.length > 0) {
                fulfillmentStatus = ORDER_FULFILLMENT.SENT
              }
              else if (totalPartialFulfillments > 0) {
                fulfillmentStatus = ORDER_FULFILLMENT.PARTIAL
              }
              else if (totalNonFulfillments >= this.fulfillments.length && this.fulfillments.length > 0) {
                fulfillmentStatus = ORDER_FULFILLMENT.NONE // back to default
              }
              else if (totalCancelledFulfillments == this.fulfillments.length && this.fulfillments.length > 0) {
                fulfillmentStatus = ORDER_FULFILLMENT.CANCELLED // back to default
              }
              // IF done or cancelled
              if (fulfillmentStatus == ORDER_FULFILLMENT.FULFILLED || fulfillmentStatus == ORDER_FULFILLMENT.CANCELLED) {
                this.status = ORDER_STATUS.CLOSED
              }

              this.total_fulfilled_fulfillments = totalFulfillments
              this.total_partial_fulfillments = totalPartialFulfillments
              this.total_sent_fulfillments  = totalSentFulfillments
              this.total_cancelled_fulfillments  = totalCancelledFulfillments
              this.total_pending_fulfillments = totalNonFulfillments
              this.fulfillment_status = fulfillmentStatus
              return this
            },
            /**
             * Resolve if this should subscribe immediately
             * @returns {*}
             */
            resolveSubscribeImmediately: function() {
              let immediate = false
              if (!this.has_subscription) {
                return Promise.resolve(immediate)
              }
              if (this.fulfillment_status !== ORDER_FULFILLMENT.NONE) {
                return Promise.resolve(immediate)
              }
              return Promise.resolve()
                .then(() => {
                  if (this.transactions && this.transactions.length > 0) {
                    return Promise.resolve(this.transactions)
                  }
                  else {
                    return this.getTransactions()
                  }
                })
                .then(transactions => {
                  let total = 0
                  const successes = transactions.filter(transaction => transaction.status == TRANSACTION_STATUS.SUCCESS)
                  successes.forEach(success => {
                    if (success.kind === TRANSACTION_KIND.CAPTURE) {
                      total = total + success.amount
                    }
                    if (success.kind === TRANSACTION_KIND.SALE) {
                      total = total + success.amount
                    }
                  })
                  if (total >= this.total_price) {
                    immediate = true
                  }
                  return Promise.resolve(immediate)
                })
            },
            /**
             * Resolve if this should send to fulfillment immediately
             * @returns {*}
             */
            resolveSendImmediately: function() {
              let immediate = false
              if (this.fulfillment_kind !== ORDER_FULFILLMENT_KIND.IMMEDIATE) {
                return Promise.resolve(immediate)
              }
              if (this.fulfillment_status !== ORDER_FULFILLMENT.NONE) {
                return Promise.resolve(immediate)
              }
              return Promise.resolve()
                .then(() => {
                  // if (this.transactions && this.transactions.length > 0) {
                  //   return Promise.resolve(this.transactions)
                  // }
                  // else {
                  return this.getTransactions()
                  // }
                })
                .then(transactions => {
                  let total = 0
                  const successes = transactions.filter(transaction => transaction.status == TRANSACTION_STATUS.SUCCESS)

                  successes.forEach(success => {
                    if (success.kind === TRANSACTION_KIND.CAPTURE) {
                      total = total + success.amount
                    }
                    if (success.kind === TRANSACTION_KIND.SALE) {
                      total = total + success.amount
                    }
                  })
                  if (total >= this.total_price) {
                    immediate = true
                  }
                  return Promise.resolve(immediate)
                })
            },
            attemptImmediate: function(options) {
              options = options || {}
              return Promise.resolve()
                .then(() => {
                  return this.resolveSendImmediately()
                })
                .then(immediate => {
                  if (immediate) {
                    return app.services.FulfillmentService.sendOrderToFulfillment(this)
                  }
                  else {
                    return [] //app.services.FulfillmentService.scheduleOrderToFulfillment(this)
                  }
                })
                .then(fulfillments => {
                  // Set the fulfillments to the resOrder
                  this.set('fulfillments', fulfillments || [])

                  // Determine if this subscription should be created immediately
                  return this.resolveSubscribeImmediately()
                })
                .then(immediate => {
                  if (immediate) {
                    return app.services.SubscriptionService.setupSubscriptions(this, immediate, options)
                  }
                  else {
                    return []
                  }
                })
                .then((subscriptions) => {
                  this.set('subscriptions', subscriptions || [])
                  return this
                })
            },
            /**
             * Builds obj for Order Item
             * @param item
             * @param qty
             * @param properties
             */
            // TODO resolve vendor, check fulfillable quantity, calculate price
            buildOrderItem: function(item, qty, properties) {
              qty = qty || 0
              const OrderItem = app.orm['OrderItem']

              return OrderItem.build({
                order_id: this.id,
                product_id: item.product_id,
                title: item.Product.title,
                product_handle: item.Product.handle,
                variant_id: item.id,
                variant_title: item.title,
                sku: item.sku,
                type: item.type,
                name: item.title == item.Product.title ? item.title : `${item.Product.title} - ${item.title}`,
                quantity: qty,
                properties: properties,
                option: item.option,
                barcode: item.barcode,
                price: item.price,
                calculated_price: item.price * qty,
                compare_at_price: item.compare_at_price * qty,
                price_per_unit: item.price,
                currency: item.currency,
                fulfillment_service: item.fulfillment_service,
                gift_card: item.gift_card,
                requires_shipping: item.requires_shipping,
                taxable: item.requires_tax,
                tax_code: item.tax_code,
                tax_lines: item.tax_lines || [],
                shipping_lines: item.shipping_lines || [],
                discounted_lines: item.discounted_lines || [],
                coupon_lines: item.coupon_lines || [],
                requires_subscription: item.requires_subscription,
                subscription_interval: item.subscription_interval,
                subscription_unit: item.subscription_unit,
                weight: item.weight * qty,
                weight_unit: item.weight_unit,
                images: item.images.length > 0 ? item.images : item.Product.images,
                fulfillable_quantity: item.fulfillable_quantity || qty,
                max_quantity: item.max_quantity,
                grams: app.services.ProxyCartService.resolveConversion(item.weight, item.weight_unit) * qty,
                total_discounts: 0,
                vendor_id: item.Product.vendors ? item.Product.vendors[0].id : null,
                live_mode: item.live_mode
              })
            },
            // TODO add new tax_lines shipping_lines coupon_lines discount_lines to parent order
            addItem: function(orderItem) {
              if (!this.order_items) {
                const err = new Error('Order.addItem requires order_items to be populated')
                return Promise.reject(err)
              }
              return Promise.resolve()
                .then(() => {
                  const prevOrderItem = this.order_items.find(item =>
                    item.product_id === orderItem.product_id && item.variant_id === orderItem.variant_id)

                  if (!prevOrderItem) {
                    return orderItem.save()
                  }
                  else {
                    prevOrderItem.quantity = prevOrderItem.quantity + orderItem.quantity
                    prevOrderItem.fufillable_quantity = prevOrderItem.fufillable_quantity + orderItem.fulfillable_quantity
                    prevOrderItem.price = prevOrderItem.price + orderItem.price
                    prevOrderItem.calculated_price = prevOrderItem.calculated_price + orderItem.calculated_price
                    prevOrderItem.weight = prevOrderItem.weight + orderItem.weight
                    prevOrderItem.total_weight = prevOrderItem.total_weight + orderItem.total_weight

                    if (orderItem.properties) {
                      prevOrderItem.properties = orderItem.properties
                    }
                    return prevOrderItem.save()
                  }
                })
                .then(() => {
                  return this.reload()
                })
            },
            // TODO add new taxlines shippinglines couponlines discountlines to parent order
            updateItem: function(orderItem) {
              if (!this.order_items) {
                const err = new Error('Order.addItem requires order_items to be populated')
                return Promise.reject(err)
              }

              return Promise.resolve()
                .then(() => {
                  const prevOrderItem = this.order_items.find(item =>
                    item.product_id === orderItem.product_id && item.variant_id === orderItem.variant_id)

                  if (!prevOrderItem) {
                    return
                  }

                  prevOrderItem.quantity = prevOrderItem.quantity + orderItem.quantity
                  prevOrderItem.price = prevOrderItem.price + orderItem.price
                  prevOrderItem.calculated_price = prevOrderItem.calculated_price + orderItem.calculated_price
                  prevOrderItem.weight = prevOrderItem.weight + orderItem.weight
                  prevOrderItem.total_weight = prevOrderItem.total_weight + orderItem.total_weight

                  if (orderItem.properties) {
                    prevOrderItem.properties = orderItem.properties
                  }

                  return prevOrderItem.save()
                })
                .then(() => {
                  return this.reload()
                })
            },
            // TODO remove tax_lines shipping_lines coupon_lines discount_lines to parent order
            removeItem: function(orderItem) {
              if (!this.order_items) {
                const err = new Error('Order.addItem requires order_items to be populated')
                return Promise.reject(err)
              }

              return Promise.resolve()
                .then(() => {
                  const prevOrderItem = this.order_items.find(item =>
                    item.product_id === orderItem.product_id && item.variant_id === orderItem.variant_id)

                  if (!prevOrderItem) {
                    return
                  }

                  prevOrderItem.quantity = prevOrderItem.quantity - orderItem.quantity
                  prevOrderItem.price = prevOrderItem.price - orderItem.price
                  prevOrderItem.calculated_price = prevOrderItem.calculated_price - orderItem.calculated_price
                  prevOrderItem.weight = prevOrderItem.weight - orderItem.weight
                  prevOrderItem.total_weight = prevOrderItem.total_weight - orderItem.total_weight

                  if (prevOrderItem.quantity <= 0) {
                    return prevOrderItem.destroy()
                  }
                  else {
                    return prevOrderItem.save()
                  }
                })
                .then(() => {
                  return this.reload()
                })
            },
            reconcileTransactions: function() {
              if (this.changed('total_due')) {
                // partially cancel/void/refund
                if (this.total_due <= this.previous('total_due')) {
                  const amount = this.previous('total_due') - this.total_due
                  console.log('VOID/REFUND TRANSACTION', amount)
                  return app.services.TransactionService.reconcileUpdate(this, amount)
                }
                // authorize/capture/sale
                else {
                  const amount = this.total_due - this.previous('total_due')
                  console.log('CREATE NEW TRANSACTION', amount)
                  return app.services.TransactionService.reconcileCreate(this, amount)
                }
              }
              else {
                return Promise.resolve(this)
              }
            },
            reconcileFulfillments: function() {
              if (this.changed('total_items')) {
                if (this.previous('total_items') < this.total_items) {
                  console.log('remove item from fulfillment')
                  return app.services.FulfillmentService.reconcileUpdate(this)
                }
                else {
                  console.log('add item to fulfillment')
                  return app.services.FulfillmentService.reconcileCreate(this)
                }
              }
              else {
                return Promise.resolve(this)
              }
            },
            // TODO set up new transactions/fulfillments?
            recalculate: function() {
              let resOrderItems, resTransactions, resFulfillments

              let totalLineItemsPrice = 0
              let totalShipping = 0
              let totalTax = 0
              let totalDiscounts = 0
              let totalCoupons = 0
              let totalOverrides = 0
              let totalItems = 0

              this.tax_lines.forEach(i => {
                totalTax = totalTax + i.price
              })
              this.shipping_lines.forEach(i => {
                totalShipping = totalShipping + i.price
              })
              this.pricing_overrides.forEach(i => {
                totalOverrides = totalOverrides + i.price
              })
              this.discounted_lines.forEach(i => {
                totalDiscounts = totalDiscounts + i.price
              })
              this.coupon_lines.forEach(i => {
                totalCoupons = totalCoupons + i.price
              })

              this.total_tax = totalTax
              this.total_shipping = totalShipping
              this.total_discounts = totalDiscounts
              this.total_coupons = totalCoupons
              this.total_overrides = totalOverrides

              return Promise.resolve()
                .then(() => {
                  if (!this.order_items) {
                    return this.getOrder_items()
                  }
                  else {
                    return this.order_items
                  }
                })
                .then(foundItems => {
                  resOrderItems = foundItems || []
                  this.set('order_items', resOrderItems)

                  resOrderItems.forEach(item => {
                    totalLineItemsPrice = totalLineItemsPrice + item.price
                    totalItems = totalItems + item.quantity
                  })

                  // Set the Total Items
                  this.total_items = totalItems

                  // Set the Total Line Items Price
                  this.total_line_items_price = totalLineItemsPrice

                  this.subtotal_price = Math.max(0, this.total_line_items_price)
                  this.total_price = Math.max(0, this.total_line_items_price + this.total_tax + this.total_shipping - this.total_discounts - this.total_coupons - this.total_overrides)

                  if (!this.transactions) {
                    return this.getTransactions()
                  }
                  else {
                    return this.transactions
                  }
                })
                .then(foundTransactions => {
                  resTransactions = foundTransactions || []
                  this.set('transactions', resTransactions)
                  this.setFinancialStatus()
                  return this.reconcileTransactions()
                })
                .then(() => {

                  if (!this.fulfillments) {
                    return this.getFulfillments()
                  }
                  else {
                    return this.fulfillments
                  }
                })
                .then(foundFulfillments => {
                  resFulfillments = foundFulfillments || []
                  this.set('fulfillments', resFulfillments)
                  this.setFulfillmentStatus()
                  return this.reconcileFulfillments()
                })
                .then(() => {
                  // Save the new Financial Status
                  return this.saveFinancialStatus()
                })
                .then(() => {
                  // Save the new Fulfillment Status
                  return this.saveFulfillmentStatus()
                })
                .then(() => {
                  return this.save()
                })
            }
          }
        }
      }
    }
    return config
  }

  static schema (app, Sequelize) {
    let schema = {}
    if (app.config.database.orm === 'sequelize') {
      schema = {
        // Unique identifier for a particular cart that is attached to a particular order.
        cart_token: {
          type: Sequelize.STRING,
          // references: {
          //   model: app.models['Cart'],
          //   key: 'token'
          // }
        },
        subscription_token: {
          type: Sequelize.STRING,
          // references: {
          //   model: app.models['Subscription'],
          //   key: 'token'
          // }
        },
        // Unique identifier for a particular order.
        token: {
          type: Sequelize.STRING,
          unique: true
        },
        customer_id: {
          type: Sequelize.INTEGER,
          allowNull: true
          // references: {
          //   model: app.models['Customer'],
          //   key: 'id'
          // }
        },
        shop_id: {
          type: Sequelize.INTEGER,
          // references: {
          //   model: app.models['Shop'],
          //   key: 'id'
          // }
        },
        // TODO Enable User or Owner
        // Only present on orders processed at point of sale. The unique numerical identifier for the user logged into the terminal at the time the order was processed at.
        user_id: {
          type: Sequelize.INTEGER,
          // references: {
          //   model: 'User',
          //   key: 'id'
          // }
        },
        // If this order contains an item that requires shipping
        has_shipping: {
          type: Sequelize.BOOLEAN,
          defaultValue: false
        },
        // If this order contains an item that requires a subscription
        has_subscription: {
          type: Sequelize.BOOLEAN,
          defaultValue: false
        },
        total_items: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // Billing Address on Order
        billing_address: helpers.JSONB('Order', app, Sequelize, 'billing_address', {
          defaultValue: {}
        }),
        // Shipping Address on Order
        shipping_address: helpers.JSONB('Order', app, Sequelize, 'shipping_address', {
          defaultValue: {}
        }),
        // If Buyer Accepts marketing
        buyer_accepts_marketing: {
          type: Sequelize.BOOLEAN,
          defaultValue: true
        },
        // The reason why the order was cancelled. If the order was not cancelled, this value is "null."
        cancel_reason: {
          type: Sequelize.ENUM,
          values: _.values(ORDER_CANCEL)
        },
        // The time the order was cancelled
        cancelled_at: {
          type: Sequelize.DATE
        },
        // The details from the browser that placed the order
        client_details: helpers.JSONB('Order', app, Sequelize, 'client_details', {
          defaultValue: {
            'host': null,
            'accept_language': null,
            'browser_height': null,
            'browser_ip': '0.0.0.0',
            'browser_width': null,
            'session_hash': null,
            'user_agent': null,
            'latitude': null,
            'longitude': null
          }
        }),
        status: {
          type: Sequelize.ENUM,
          values: _.values(ORDER_STATUS),
          defaultValue: ORDER_STATUS.OPEN
        },
        // The time the order was closed at.
        closed_at: {
          type: Sequelize.DATE
        },
        // The three letter code (ISO 4217) for the currency used for the payment.
        currency: {
          type: Sequelize.STRING,
          defaultValue: 'USD'
        },
        // The customer's email address. Is required when a billing address is present.
        email: {
          type: Sequelize.STRING,
          validate: {
            isEmail: true
          }
        },
        // pending: The finances are pending.
        // authorized: The finances have been authorized.
        // partially_paid: The finances have been partially paid.
        // paid: The finances have been paid. (This is the default value.)
        // partially_refunded: The finances have been partially refunded.
        // refunded: The finances have been refunded.
        // voided: The finances have been voided.
        financial_status: {
          type: Sequelize.ENUM,
          values: _.values(ORDER_FINANCIAL),
          defaultValue: ORDER_FINANCIAL.PENDING
        },
        payment_kind: {
          type: Sequelize.ENUM,
          values: _.values(TRANSACTION_KIND),
          defaultValue: app.config.proxyCart.order_payment_kind || TRANSACTION_KIND.MANUAL
        },
        // fulfilled: the order has been completely fulfilled
        // none: the order has no fulfillments
        // partial: the order has some fulfillments
        fulfillment_status: {
          type: Sequelize.ENUM,
          values: _.values(ORDER_FULFILLMENT),
          defaultValue: ORDER_FULFILLMENT.NONE
        },
        // immediate: immediately send to fulfillment providers
        // manual: wait until manually sent to fulfillment providers
        fulfillment_kind: {
          type: Sequelize.ENUM,
          values: _.values(ORDER_FULFILLMENT_KIND),
          defaultValue: app.config.proxyCart.order_fulfillment_kind || ORDER_FULFILLMENT_KIND.MANUAL
        },
        // The site this sale originated from
        landing_site: {
          type: Sequelize.STRING
        },
        // Only present on orders processed at point of sale. The unique numeric identifier for the physical location at which the order was processed.
        location_id: {
          type: Sequelize.STRING
        },
        // The customer's order name as represented by a number.
        name: {
          type: Sequelize.STRING
        },
        //identifier unique to the shop. A number is a shop and order sequential and starts at 1.
        number: {
          type: Sequelize.STRING
        },
        // The text of an optional note that a shop owner can attach to the order.
        note: {
          type: Sequelize.STRING
        },
        // "note_attributes": ["name": "custom name","value": "custom value"]
        // Extra information that is added to the order. Each array entry must contain a hash with "name" and "value" keys as shown above.
        note_attributes: helpers.JSONB('Order', app, Sequelize, 'note_attributes', {
          defaultValue: {}
        }),
        // The list of all payment gateways used for the order.
        payment_gateway_names: helpers.JSONB('Order', app, Sequelize, 'payment_gateway_names', {
          defaultValue: []
        }),
        // The date and time when the order was imported, in ISO 8601 format. This value can be set to dates in the past when importing from other systems. If no value is provided, it will be auto-generated.
        processed_at: {
          type: Sequelize.DATE
        },
        // States the type of payment processing method. Valid values are: checkout, subscription, direct, manual, offsite or express.
        processing_method: {
          type: Sequelize.ENUM,
          values: _.values(PAYMENT_PROCESSING_METHOD)
        },
        // The website that the customer clicked on to come to the shop.
        referring_site: {
          type: Sequelize.STRING
        },
        // An array of shipping_line objects, each of which details the shipping methods used.
        shipping_lines: helpers.JSONB('Order', app, Sequelize, 'shipping_lines', {
          defaultValue: []
        }),
        // The line_items that have discounts
        discounted_lines: helpers.JSONB('Order', app, Sequelize, 'discounted_lines', {
          defaultValue: []
        }),
        // The line_items that have coupons
        coupon_lines: helpers.JSONB('Order', app, Sequelize, 'coupon_lines', {
          defaultValue: []
        }),
        // The pricing overrides
        pricing_overrides: helpers.JSONB('Order', app, Sequelize, 'pricing_overrides', {
          defaultValue: []
        }),
        // USER id of the admin who did the override
        pricing_override_id: {
          type: Sequelize.INTEGER
        },
        // The total amount of pricing overrides
        total_overrides: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // Where the order originated. May only be set during creation, and is not writable thereafter. Orders created through official Proxy Engine channels have protected values that cannot be assigned by other API clients during order creation. These protected values are: "web", "pos", "iphone", and "android" Orders created via the API may be assigned any other string of your choice. If source_name is unspecified, new orders are assigned the value "api".
        source_name: {
          type: Sequelize.STRING,
          defaultValue: 'api'
        },
        // Price of the order before shipping and taxes
        subtotal_price: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // An array of tax_line objects, each of which details the total taxes applicable to the order.
        tax_lines: helpers.JSONB('Order', app, Sequelize, 'tax_lines', {
          defaultValue: []
        }),
        // tax_lines: helpers.ARRAY('Order', app, Sequelize, Sequelize.JSONB, 'tax_lines', {
        //   defaultValue: []
        // }),
        // An array of refund_line objects, each of which details the total refunds applicable to the order.
        refunded_lines: helpers.JSONB('Order', app, Sequelize, 'refunded_lines', {
          defaultValue: []
        }),
        // refunded_lines: helpers.ARRAY('Order', app, Sequelize, Sequelize.JSONB, 'refunded_lines', {
        //   defaultValue: []
        // }),
        // States whether or not taxes are included in the order subtotal. Valid values are "true" or "false".
        taxes_included: {
          type: Sequelize.BOOLEAN
        },
        // The total amount of the discounts applied to the price of the order.
        total_discounts: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount of coupons applied to the price of the order
        total_coupons: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount of shipping applied to the price of the order
        total_shipping: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total still due
        total_due: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount of refunded transactions
        total_refunds: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount of authorized transactions
        total_authorized: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount of captured transactions
        total_captured: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount of voided transactions
        total_voided: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount of voided transactions
        total_cancelled: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount awaiting success
        total_pending: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The sum of all the prices of all the items in the order.
        total_line_items_price: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The sum of all the prices of all the items in the order, taxes and discounts included (must be positive).
        total_price: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The sum of all the taxes applied to the order (must be positive).
        total_tax: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The sum of all the weights of the line items in the order, in grams.
        total_weight: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount of Fulfillments fulfilled
        total_fulfilled_fulfillments: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount of Fulfillments partially fulfilled
        total_partial_fulfillments: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount of Fulfillments left to send to fulfillment
        total_sent_fulfillments: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        total_cancelled_fulfillments: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // The total amount of Fulfillments not yet fulfilled
        total_pending_fulfillments: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        // IP addresses
        ip: {
          type: Sequelize.STRING
        },
        // IP address that created the order
        create_ip: {
          type: Sequelize.STRING
        },
        // IP address that last updated the order
        update_ip: {
          type: Sequelize.STRING
        },
        // Live Mode
        live_mode: {
          type: Sequelize.BOOLEAN,
          defaultValue: app.config.proxyEngine.live_mode
        }
      }
    }
    return schema
  }
}
