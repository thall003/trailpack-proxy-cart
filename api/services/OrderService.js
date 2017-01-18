'use strict'

const Service = require('trails/service')
const _ = require('lodash')
const Errors = require('proxy-engine-errors')
const PAYMENT_PROCESSING_METHOD = require('../utils/enums').PAYMENT_PROCESSING_METHOD
/**
 * @module OrderService
 * @description Order Service
 */
module.exports = class OrderService extends Service {
  /**
   *
   * @param order
   * @param options
   * @returns {Promise}
   */
  resolve(order, options) {
    const Order =  this.app.services.ProxyEngineService.getModel('Order')
    if (order instanceof Order.Instance){
      return Promise.resolve(order)
    }
    else if (order && _.isObject(order) && order.id) {
      return Order.findById(order.id, options)
        .then(resOrder => {
          if (!resOrder) {
            throw new Errors.FoundError(Error(`Order ${order.id} not found`))
          }
          return resOrder
        })
    }
    else if (order && (_.isString(order) || _.isNumber(order))) {
      return Order.findById(order, options)
        .then(resOrder => {
          if (!resOrder) {
            throw new Errors.FoundError(Error(`Order ${order} not found`))
          }
          return resOrder
        })
    }
    else {
      const err = new Error('Unable to resolve Order')
      Promise.reject(err)
    }
  }

  /**
   *
   * @param obj
   * @returns {Promise}
   */
  // TODO handle taxes, shipping, subscriptions, start transactions/fulfillment
  // TODO handle inventory policy
  create(obj) {
    const Address = this.app.services.ProxyEngineService.getModel('Address')
    const Customer = this.app.services.ProxyEngineService.getModel('Customer')
    const Cart = this.app.services.ProxyEngineService.getModel('Cart')
    const Order = this.app.services.ProxyEngineService.getModel('Order')
    const OrderItem = this.app.services.ProxyEngineService.getModel('OrderItem')
    const PaymentService = this.app.services.PaymentService

    // Validate obj cart and customer
    if (!obj.cart_token) {
      const err = new Errors.FoundError(Error('Missing Cart token'))
      return Promise.reject(err)
    }
    if (!obj.payment_details) {
      const err = new Errors.FoundError(Error('Missing Payment Details'))
      return Promise.reject(err)
    }

    let resOrder = {}
    let resCart = {}
    let resCustomer = {}
    let resBillingAddress = {}
    let resShippingAddress = {}

    return Order.sequelize.transaction(t => {
      return Cart.find({where: {token: obj.cart_token}})
        .then(cart => {
          if (!cart) {
            throw new Errors.FoundError(Error(`Could not find cart by token '${obj.cart_token}'`))
          }
          if (cart.status !== Cart.CART_STATUS.OPEN) {
            throw new Errors.ConflictError(Error(`Cart status '${cart.status}' is not '${Cart.CART_STATUS.OPEN}'`))
          }
          resCart = cart
          // If a customer is attached to this order
          if (obj.customer_id) {
            return Customer.findById(obj.customer_id, {
              include: [
                {
                  model: Address,
                  as: 'shipping_address'
                },
                {
                  model: Address,
                  as: 'billing_address'
                }
              ]
            })
          }
          else {
            return null
          }
        })
        .then(customer => {
          if (customer && !customer.billing_address && !obj.billing_address) {
            throw new Errors.FoundError(Error(`Could not find customer billing address for id '${obj.customer_id}'`))
          }
          if (customer && !customer.shipping_address && !obj.shipping_address) {
            throw new Errors.FoundError(Error(`Could not find customer shipping address for id '${obj.customer_id}'`))
          }
          if (!customer) {
            resCustomer = {
              id: null,
              billing_address: null,
              shipping_address: null
            }
          }
          else {
            resCustomer = customer
          }
          resBillingAddress = resCustomer.billing_address ? resCustomer.billing_address.get({plain: true}) : obj.billing_address
          resShippingAddress = resCustomer.shipping_address ? resCustomer.shipping_address.get({plain: true}) : obj.shipping_address
          // If Addresses, validate them
          if (resBillingAddress) {
            resBillingAddress = this.app.services.ProxyCartService.validateAddress(resBillingAddress)
          }
          if (resShippingAddress) {
            resShippingAddress = this.app.services.ProxyCartService.validateAddress(resShippingAddress)
          }

          const order = {
            // Order Info
            processing_method: obj.processing_method || PAYMENT_PROCESSING_METHOD.DIRECT,

            // Cart Info
            cart_token: resCart.token,
            currency: resCart.currency,
            order_items: resCart.line_items,
            tax_lines: resCart.tax_lines,
            shipping_lines: resCart.shipping_lines,
            subtotal_price: resCart.subtotal_price,
            taxes_included: resCart.taxes_included,
            total_discounts: resCart.total_discounts,
            total_line_items_price: resCart.total_line_items_price,
            total_price: resCart.total_price,
            total_tax: resCart.total_tax,
            total_weight: resCart.total_weight,

            // Client Info
            client_details: obj.client_details,
            ip: obj.ip,

            // Customer Info
            customer_id: resCustomer.id, // (May Be Null)
            buyer_accepts_marketing: resCustomer.accepts_marketing || obj.buyer_accepts_marketing,
            email: resCustomer.email || obj.email,
            billing_address: resBillingAddress,
            shipping_address: resShippingAddress
          }

          return Order.create(order, {
            include: [
              {
                model: OrderItem,
                as: 'order_items'
              }
            ]
          })
        })
        .then(order => {
          resOrder = order
          // Close the Cart
          resCart.close(Cart.CART_STATUS.ORDERED)
          return resCart.save()
        })
        .then(cart => {
          if (resCustomer instanceof Customer.Instance) {
            resCustomer.setLastOrder(resOrder)
            // TODO create a blank new cart for customer
            // resCustomer.newCart()
            return resCustomer.save()
          }
          else {
            return null
          }
        })
        .then(customer => {
          // Set proxy cart default payment kind if not set by order.create
          let orderPayment = obj.payment_kind || this.app.config.proxyCart.order_payment_kind
          if (!orderPayment) {
            this.app.log.debug('Order does not have a payment function, defaulting to manual')
            orderPayment = 'manual'
          }
          const transaction = {
            order_id: resOrder.id,
            currency: resOrder.currency,
            amount: resOrder.total_price,
            payment_details: obj.payment_details,
            device_id: obj.device_id || null
          }
          return PaymentService[orderPayment](transaction)
            // .then(transaction => {
            //   resOrder.setFinancialStatus([transaction])
            //   return resOrder.save()
            // })
        })
        .then(order => {
          return Order.findIdDefault(resOrder.id)
        })
    })
  }

  /**
   *
   * @param order
   * @returns {*|Promise.<TResult>}
   */
  payOrder(order, gateway) {
    return this.resolve(order)
      .then(order => {
        if (order.financial_status !== ('authorized' || 'partially_paid')) {
          throw new Error(`Order status is ${order.financial_status} not 'authorized or partially_paid'`)
        }
        return order
      })
  }
  /**
   *
   * @param order
   * @returns {*|Promise.<TResult>}
   */
  refundOrder(order, refund) {
    return this.resolve(order)
      .then(order => {

        return order
      })
  }
}

