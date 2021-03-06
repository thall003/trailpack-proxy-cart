'use strict'
const joi = require('joi')
const addressSchema = require('../address/address')
const cartSchema = require('../cart/cart')
const tagsSchema = require('../tag/tags')
const metadataSchema = require('../metadata/metadata')
module.exports = joi.object().keys({
  id: joi.any(),
  accepts_marketing: joi.boolean(),
  first_name: joi.string(),
  last_name: joi.string(),
  email: joi.string(),
  company: joi.string(),
  note: joi.string(),
  cart: joi.any(),
  default_cart: cartSchema,
  default_address: addressSchema,
  shipping_address: addressSchema,
  billing_address: addressSchema,
  metadata: metadataSchema,
  tags: tagsSchema,

  // Policy Arguments
  client_details: joi.object(),
  ip: joi.string(),
  host: joi.string()
})
