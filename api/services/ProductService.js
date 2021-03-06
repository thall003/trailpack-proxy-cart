/* eslint no-console: [0] */
'use strict'

const Service = require('trails/service')
const _ = require('lodash')
const Errors = require('proxy-engine-errors')
const PRODUCT_DEFAULTS = require('../utils/enums').PRODUCT_DEFAULTS
const VARIANT_DEFAULTS = require('../utils/enums').VARIANT_DEFAULTS

/**
 * @module ProductService
 * @description Product Service
 */
module.exports = class ProductService extends Service {
  /**
   *
   * @param item
   * @param options
   * @returns {*}
   */
  resolveItem(item, options){
    const Product = this.app.orm.Product
    const ProductVariant = this.app.orm.ProductVariant
    const Image = this.app.orm.ProductImage

    if (!options) {
      options = {}
    }

    if (item.id || item.variant_id || item.product_variant_id) {
      const id = item.id || item.variant_id || item.product_variant_id
      return ProductVariant.findById(id, {
        transaction: options.transaction || null,
        include: [
          {
            model: Product,
            include: [
              {
                model: Image,
                as: 'images',
                attributes: ['src','full','thumbnail','small','medium','large','alt','position']
              }
            ]
          },
          {
            model: Image,
            as: 'images',
            attributes: ['src','full','thumbnail','small','medium','large','alt','position']
          }
        ]
      })
    }
    else if (item.product_id) {
      return ProductVariant.find({
        where: {
          product_id: item.product_id,
          position: 1
        },
        transaction: options.transaction || null,
        include: [
          {
            model: Product,
            include: [
              {
                model: Image,
                as: 'images',
                attributes: ['src','full','thumbnail','small','medium','large','alt','position']
              }
            ]
          },
          {
            model: Image,
            as: 'images',
            attributes: ['src','full','thumbnail','small','medium','large','alt','position']
          }
        ]
      })
    }
    else {
      const err = new Errors.FoundError(Error(`${item} not found`))
      return Promise.reject(err)
    }
  }
  /**
   * Add Multiple Products
   * @param products
   * @returns {Promise.<*>}
   */
  addProducts(products) {
    if (!Array.isArray(products)) {
      products = [products]
    }
    const Sequelize = this.app.orm.Product.sequelize
    // const addedProducts = []
    // Setup Transaction
    return Sequelize.transaction(t => {
      return Sequelize.Promise.mapSeries(products, product => {
        return this.addProduct(product, {
          transaction: t
        })
      })
    })
  }

  /**
   * Add a Product
   * @param product
   * @returns {Promise}
   */
  addProduct(product, options) {
    const Product = this.app.orm.Product

    if (!options) {
      options = {}
    }

    return Product.findOne({
      where: {
        host: product.host ? product.host : 'localhost',
        handle: product.handle
      },
      attributes: ['id'],
      transaction: options.transaction || null
    })
      .then(resProduct => {
        if (!resProduct) {
          // Create a new Product
          return this.createProduct(product, options)
        }
        else {
          // Set ID in case it's missing in this transaction
          product.id = resProduct.id
          // Update the existing product
          return this.updateProduct(product, options)
        }
      })
  }

  /**
   * Create A Product with default Variant
   * @param product
   * @returns {Promise}
   */
  // TODO Create Images and Variant Images in one command
  createProduct(product, options){
    const Product = this.app.orm.Product
    const Tag = this.app.orm.Tag
    const Variant = this.app.orm.ProductVariant
    const Image = this.app.orm.ProductImage
    const Metadata = this.app.orm.Metadata
    const Collection = this.app.orm.Collection
    const Vendor = this.app.orm.Vendor
    const Shop = this.app.orm.Shop

    if (!options) {
      options = {}
    }

    product = this.productDefaults(product)

    // The Default Product
    const create = {
      host: product.host,
      handle: product.handle,
      title: product.title,
      body: product.body,
      type: product.type,
      price: product.price,
      published: product.published,
      published_scope: product.published_scope,
      weight: product.weight,
      weight_unit: product.weight_unit,
      average_shipping: product.average_shipping,
      metadata: Metadata.transform(product.metadata || {}),
      options: []
    }
    // create = Product.build(create)

    if (product.published) {
      create.published_at = new Date()
    }
    if (product.published_scope) {
      create.published_scope = product.published_scope
    }
    if (product.seo_title) {
      create.seo_title = product.seo_title
    }
    else {
      create.seo_title = product.title
    }
    if (product.seo_description) {
      create.seo_description = product.seo_description
    }
    else {
      create.seo_description = product.body
    }

    // Images
    let images = []
    // If this request came with product images
    if (product.images) {
      _.map(product.images, image => {
        image.variant = 0
      })
      images = images.concat(product.images)
      delete product.images
    }

    // Variants
    // Set a default variant based of off product
    let variants = [{
      sku: product.sku
    }]
    // Set the published status
    if (product.published) {
      variants[0].published_at = create.published_at
    }
    // If this is not a true variant because it is missing a sku (which is required), let's remove it.
    if (!variants[0].sku) {
      variants.splice(0,1)
    }
    // Add variants to the default
    if (product.variants) {
      variants = variants.concat(product.variants)
    }
    // For every variant, map missing defaults and images
    _.map(variants, (variant, index) => {
      variant = this.variantDefaults(variant, product)
      // Map Variant Positions putting default at 1
      //if (!variant.position) {
      variant.position = index + 1
      //}
      // If this variant is not explicitly not published set to status of parent
      if (product.published && variant.published !== false) {
        variant.published = true
      }
      // If this variant is published then set published_at to same as parent
      if (variant.published) {
        variant.published_at = create.published_at
      }
      // Handle Variant Images
      if (variant.images && variant.images.length > 0) {
        _.map(variant.images, image => {
          image.variant = index
        })
        images = images.concat(variant.images)
        delete variant.images
      }
      if (variant.option) {
        const keys = Object.keys(variant.option)
        create.options = _.union(create.options, keys)
      }
    })

    // Assign the variants to the create model
    create.variants = variants
    create.total_variants = variants.length

    // Map image positions
    _.map(images, (image, index) => {
      image.position = index + 1
    })

    // Set the resulting Product
    let resProduct = {}
    return Product.create(create, {
      transaction: options.transaction || null,
      include: [
        {
          model: Tag,
          as: 'tags'
        },
        {
          model: Image,
          as: 'images'
        },
        {
          model: Variant,
          as: 'variants',
          include: [
            {
              model: Metadata,
              as: 'metadata'
            }
          ]
            // include: [
            //   {
            //     model: Image,
            //     as: 'images'
            //   }
            // ]
        },
        {
          model: Metadata,
          as: 'metadata',
        },
        {
          model: Vendor,
          as: 'vendors'
        },
        {
          model: Collection,
          as: 'collections'
        }
      ]
    })
      .then(createdProduct => {
        resProduct = createdProduct
        // console.log('createdProduct',createdProduct)
        if (product.tags && product.tags.length > 0) {
          product.tags = _.sortedUniq(product.tags.filter(n => n))
          // console.log('THIS PRODUCT TAGS NOW', product.tags)
          return Tag.transformTags(product.tags, {transaction: options.transaction || null})
        }
        return
      })
      .then(tags => {
        if (tags && tags.length > 0) {
          // Add Tags
          return resProduct.setTags(_.map(tags, tag  => tag.id), {transaction: options.transaction || null})
        }
        return
      })
      .then(productTags => {
        if (product.shops && product.shops.length > 0) {
          product.shops = _.sortedUniq(product.shops.filter(n => n))
          // console.log('THIS PRODUCT SHOPS NOW', product.shops)
          return Shop.transformShops(product.shops, {transaction: options.transaction || null})
        }
        return
      })
      .then(shops => {
        if (shops && shops.length > 0) {
          return resProduct.setShops(shops, {transaction: options.transaction || null})
        }
        return
      })
      .then(shops => {
        // console.log('THESE COLLECTIONS', product.collections)
        if (product.collections && product.collections.length > 0) {
          // Resolve the collections
          product.collections = _.sortedUniq(product.collections.filter(n => n))
          // console.log('THIS PRODUCT COLLECTIONS NOW', product.collections)
          return Collection.transformCollections(product.collections, {transaction: options.transaction || null})
        }
        return
      })
      .then(collections => {
        // console.log('THESE COLLECTIONS RESOLVED', collections)
        if (collections && collections.length > 0) {
          return resProduct.setCollections(_.map(collections, c => c.id), {transaction: options.transaction || null})
        }
        return
      })
      .then(productCollections => {
        if (product.vendors && product.vendors.length > 0) {
          return Vendor.transformVendors(product.vendors, {transaction: options.transaction || null})
        }
        return
      })
      .then(vendors => {
        if (vendors && vendors.length > 0) {
          // console.log('THIS VENDOR', vendor)
          return resProduct.setVendors(_.map(vendors, v => v.id), {transaction: options.transaction || null})
        }
        return
      })
      .then(vendors => {
        return Promise.all(images.map(image => {
          // image.product_id = resProduct.id
          if (typeof image.variant !== 'undefined') {
            if (resProduct.variants[image.variant]) {
              image.product_variant_id = resProduct.variants[image.variant].id
            }
            delete image.variant
          }
          return resProduct.createImage(image, {transaction: options.transaction || null})
        }))
      })
      .then(createdImages => {
        // Reload
        // console.log(resProduct)
        // return resProduct
        return Product.findByIdDefault(resProduct.id, {transaction: options.transaction || null})
      })
  }
  /**
   *
   * @param products
   * @returns {Promise.<*>}
   */
  updateProducts(products) {
    if (!Array.isArray(products)) {
      products = [products]
    }
    return this.app.orm.Product.sequelize.transaction(t => {
      return Promise.all(products.map(product => {
        return this.updateProduct(product, {
          transaction: t
        })
      }))
    })
  }

  /**
   *
   * @param product
   * @returns {Promise}
   */
  // TODO Create/Update Images and Variant Images in one command
  updateProduct(product, options) {
    const Product = this.app.orm.Product
    const Variant = this.app.orm.ProductVariant
    const Image = this.app.orm.ProductImage
    const Tag = this.app.orm.Tag
    const Collection = this.app.orm.Collection
    const Vendor = this.app.orm.Vendor
    // const Shop = this.app.orm.Shop
    // const Metadata = this.app.orm.Metadata
    if (!options) {
      options = {}
    }
    // let newTags = []
    // return Product.sequelize.transaction(t => {
    // Create an empty product options array
    const productOptions = []
    if (!product.id) {
      throw new Errors.FoundError(Error('Product is missing id'))
    }

    let resProduct = {}
    return Product.findByIdDefault(product.id, {
      transaction: options.transaction || null
    })
      .then(foundProduct => {
        resProduct = foundProduct

        const update = {
          host: product.host || resProduct.host,
          handle: product.handle || resProduct.handle,
          body: product.body || resProduct.body,
          type: product.type || resProduct.type,
          published_scope: product.published_scope || resProduct.published_scope,
          weight: product.weight || resProduct.weight,
          weight_unit: product.weight_unit || resProduct.weight_unit,
          requires_shipping: product.requires_shipping || resProduct.requires_shipping,
          tax_code: product.tax_code || resProduct.tax_code,
          options: productOptions
        }
        if (product.published) {
          resProduct.published = resProduct.variants[0].published = product.published
          resProduct.published_at = resProduct.variants[0].published_at = new Date()
        }
        if (product.published === false) {
          update.published = resProduct.variants[0].published = product.published
          update.unpublished_at = resProduct.variants[0].unpublished_at = new Date()
        }
        // If the SKU is changing, set the default sku
        if (product.sku) {
          resProduct.variants[0].sku = product.sku
        }
        // if The title is changing, set the default title
        if (product.title) {
          update.title = resProduct.variants[0].title = product.title
        }
        // if the price is changing
        if (product.price) {
          update.price = resProduct.variants[0].price = product.price
        }
        // if the compare_at_price is changing
        if (product.compare_at_price) {
          resProduct.variants[0].compare_at_price = product.compare_at_price
        }
        if (product.metadata) {
          resProduct.metadata.data = product.metadata || {}
        }

        // Update seo_title if provided, else update it if a new product title
        if (product.seo_title) {
          resProduct.seo_title = product.seo_title
        }
        else if (product.title) {
          resProduct.seo_title = product.title
        }
        // Update seo_description if provided, else update it if a new product body
        if (product.seo_description) {
          resProduct.seo_description = product.seo_description
        }
        else if (product.body) {
          resProduct.seo_description = product.body
        }

        // Update Existing Variant
        _.each(resProduct.variants, variant => {
          return _.extend(variant, _.find(product.variants, { id: variant.id }))
        })
        // Create a List of new Variants
        product.variants = _.filter(product.variants, (variant, index ) => {
          if (typeof variant.id === 'undefined') {
            variant = this.variantDefaults(variant, resProduct.get({plain: true}))
            // variant.product_id = resProduct.id
            if (variant.images ) {
              // Update the master image if new/updated attributes are defined
              _.map(resProduct.images, image => {
                return _.merge(image, _.find(variant.images, { id: image.id }))
              })
              // Remove all the images that are already created
              variant.images = _.filter(variant.images, image => {
                if (typeof id === 'undefined') {
                  // image.variant = index
                  image.product_id = resProduct.id
                  return Image.build(image)
                }
              })
              // Add these variant images to the new array.
              resProduct.images = _.concat(resProduct.images, variant.images)
              // delete variant.images
            }
            return Variant.build(variant)
          }
        })
        // Join all the variants
        resProduct.variants = _.sortBy(_.concat(resProduct.variants, product.variants), 'position')
        // Set the Positions
        _.each(resProduct.variants, (variant, index) => {
          variant.position = index + 1
        })
        resProduct.total_variants = resProduct.variants.length

        // Set the new product options
        _.each(resProduct.variants, variant => {
          if (variant.option) {
            const keys = Object.keys(variant.option)
            resProduct.options = _.union(resProduct.options, keys)
          }
        })

        // Update existing Images
        _.each(resProduct.images, image => {
          return _.extend(image, _.find(product.images, { id: image.id }))
        })
        // Create a List of new Images
        product.images = _.filter(product.images, image => {
          if (typeof image.id === 'undefined') {
            return Image.build(image)
          }
        })
        // Join all the images
        resProduct.images = _.sortBy(_.concat(resProduct.images, product.images),'position')
        // Set the Positions
        _.each(resProduct.images, (image, index) => {
          image.position = index + 1
        })

        // console.log('THESE VARIANTS', resProduct.variants)
        return resProduct.updateAttributes(update, {transaction: options.transaction || null})
      })
      .then(updateProduct => {
        // Transform any new Tags
        if (product.tags && product.tags.length > 0) {
          product.tags = _.sortedUniq(product.tags.filter(n => n))
          return Tag.transformTags(product.tags, {transaction: options.transaction || null})
        }
        return
      })
      .then(tags => {
        // Set Tags
        if (tags && tags.length > 0) {
          return resProduct.setTags(_.map(tags, t  => t.id), {transaction: options.transaction || null})
        }
        return
      })
      .then(productTags => {
        if (product.collections && product.collections.length > 0) {
          // Resolve the collections
          product.collections = _.sortedUniq(product.collections.filter(n => n))
          return Collection.transformCollections(product.collections, {transaction: options.transaction || null})
        }
        return
      })
      .then(collections => {
        // console.log('THESE COLLECTIONS', collections)
        if (collections && collections.length > 0) {
          return resProduct.setCollections(_.map(collections, c => c.id), {transaction: options.transaction || null})
        }
        return
      })
      .then(collections => {
        // save the metadata
        return resProduct.metadata.save({ transaction: options.transaction || null })
      })
      .then(metadata => {
        if (product.vendors && product.vendors.length > 0) {
          return Vendor.transformVendors(product.vendors, {transaction: options.transaction || null})
        }
        return
      })
      .then(vendors => {
        if (vendors && vendors.length > 0) {
          return resProduct.setVendors(_.map(vendors, v => v.id), { transaction: options.transaction || null })
        }
        return
      })
      .then(vendors => {
        return Promise.all(resProduct.variants.map(variant => {
          // gather options
          if (variant.option) {
            if (!_.some(productOptions, option => variant.option.name)) {
              productOptions.push(variant.option.name)
            }
          }

          if (variant.id) {
            return variant.save({ transaction: options.transaction || null })
          }
          else {
            return resProduct.createVariant(variant, {
              transaction: options.transaction || null
            })
          }
        }))
      })
      .then(variants => {
        // console.log('THESE VARIANTS', variants)
        // return Product.findByIdDefault(resProduct.id)
        return Promise.all(resProduct.images.map(image => {
          if (typeof image.variant !== 'undefined') {
            image.product_variant_id = resProduct.variants[image.variant].id
            delete image.variant
          }
          if (image.id) {
            return image.save({ transaction: options.transaction || null })
          }
          else {
            return resProduct.createImage(image, {
              transaction: options.transaction || null
            })
          }
        }))
      })
      .then(images => {
        return Product.findByIdDefault(resProduct.id, {
          transaction: options.transaction || null
        })
      })
  }
  /**
   *
   * @param products
   * @returns {Promise.<*>}
   */
  removeProducts(products) {
    if (!Array.isArray(products)) {
      products = [products]
    }
    return Promise.all(products.map(product => {
      return this.removeProduct(product)
    }))
  }

  /**
   *
   * @param product
   */
  removeProduct(product, options) {
    if (!options) {
      options = {}
    }
    if (!product.id) {
      const err = new Errors.FoundError(Error('Product is missing id'))
      return Promise.reject(err)
    }
    const Product = this.app.orm.Product
    return Product.destroy({
      where: {
        id: product.id
      },
      transaction: options.transaction || null
    })
  }

  /**
   *
   * @param variants
   */
  removeVariants(variants){
    if (!Array.isArray(variants)) {
      variants = [variants]
    }
    return Promise.all(variants.map(variant => {
      return this.removeVariant(variant)
    }))
  }

  /**
   *
   * @param product
   * @param variant
   * @param options
   */
  // TODO upload images
  createVariant(product, variant, options) {
    options = options || {}
    const Product = this.app.orm['Product']
    const Variant = this.app.orm['ProductVariant']
    let resProduct, resVariant, productOptions = []
    return Product.resolve(product)
      .then(product => {
        if (!product) {
          throw new Errors.FoundError(Error('Could not find Product'))
        }
        resProduct = product

        variant.product_id = resProduct.id
        variant = this.variantDefaults(variant, resProduct)

        return resProduct.createVariant(variant)
        // return this.resolveVariant(variant, options)
      })
      .then(variant => {
        resVariant = variant

        return Variant.findAll({
          where: {
            product_id: resProduct.id
          },
          transaction: options.transaction || null
        })
      })
      .then(variants => {
        const updates = _.sortBy(variants, 'position')
        _.map(updates, (variant, index) => {
          variant.position = index + 1
        })
        _.map(updates, variant => {
          const keys = Object.keys(variant.option)
          productOptions = _.union(productOptions, keys)
        })
        return Promise.all(updates.map(variant => {
          return variant.save({
            transaction: options.transaction || null
          })
        }))
      })
      .then(updatedVariants => {
        resProduct.options = product.options
        resProduct.total_variants = updatedVariants.length
        return resProduct.save({transaction: options.transaction || null})
      })
      .then(updatedProduct => {
        return Variant.findByIdDefault(resVariant.id, {transaction: options.transaction || null})
      })
  }

  /**
   *
   * @param product
   * @param variants
   * @param options
   * @returns {Promise.<*>}
   */
  createVariants(product, variants, options) {
    return Promise.all(variants.map(variant => {
      return this.createVariant(product, variant, options)
    }))
  }

  /**
   *
   * @param product
   * @param variant
   * @param options
   */
  // TODO upload images
  updateVariant(product, variant, options) {
    options = options || {}
    const Product = this.app.orm['Product']
    const Variant = this.app.orm['ProductVariant']
    let  resProduct, resVariant, productOptions = []
    return Product.resolve(product)
      .then(product => {
        resProduct = product
        return Variant.resolve(variant, options)
      })
      // TODO Update
      .then(foundVariant => {
        resVariant = foundVariant
        resVariant = _.extend(resVariant, _.omit(variant, ['id','sku']))
        resVariant = this.variantDefaults(resVariant, resProduct)
        return resVariant.save({transaction: options.transaction || null})
      })
      .then(variant => {
        return Variant.findAll({
          where: {
            product_id: resProduct.id
          },
          transaction: options.transaction || null
        })
      })
      .then(variants => {
        const updates = _.sortBy(variants, 'position')
        _.map(updates, (variant, index) => {
          variant.position = index + 1
        })
        _.map(updates, variant => {
          const keys = Object.keys(variant.option)
          productOptions = _.union(productOptions, keys)
        })
        return Promise.all(updates.map(variant => {
          return variant.save({
            transaction: options.transaction || null
          })
        }))
      })
      .then(updatedVariants => {
        resProduct.options = product.options
        return resProduct.save({transaction: options.transaction || null})
      })
      .then(updatedProduct => {
        return Variant.findByIdDefault(resVariant.id, {transaction: options.transaction || null})
      })

  }
  updateVariants(product, variants, options) {
    return Promise.all(variants.map(variant => {
      return this.updateVariant(product, variant, options)
    }))
  }
  /**
   *
   * @param id
   */
  removeVariant(id, options){
    options = options || {}
    const Product = this.app.orm['Product']
    const Variant = this.app.orm.ProductVariant
    let resVariant, resProduct
    let updates
    let productOptions = []
    return Variant.resolve(id, {
      transaction: options.transaction || null
    })
      .then(foundVariant => {
        resVariant = foundVariant
        return Product.resolve(resVariant.product_id)
      })
      .then(product => {
        resProduct = product
        return Variant.findAll({
          where: {
            product_id: resVariant.product_id
          },
          transaction: options.transaction || null
        })
      })
      .then(foundVariants => {
        updates = _.sortBy(_.filter(foundVariants, variant => {
          if (variant.id !== resVariant.id){
            return variant
          }
        }), 'position')
        _.map(updates, (variant, index) => {
          variant.position = index + 1
        })
        _.map(updates, variant => {
          const keys = Object.keys(variant.option)
          productOptions = _.union(productOptions, keys)
        })
        return Promise.all(updates.map(variant => {
          return variant.save({
            transaction: options.transaction || null
          })
        }))
      })
      .then(updatedVariants => {
        resProduct.options = productOptions
        resProduct.total_variants = updatedVariants.length
        return resProduct.save({transaction: options.transaction || null})
      })
      .then(updatedProduct => {
        return resVariant.destroy({transaction: options.transaction || null})
      })
      .then(destroyed => {
        return resVariant
      })
  }

  /**
   *
   * @param images
   */
  removeImages(images){
    if (!Array.isArray(images)) {
      images = [images]
    }
    return Promise.all(images.map(image => {
      const id = typeof image.id !== 'undefined' ? image.id : image
      return this.removeImage(id)
    }))
  }

  /**
   *
   * @param id
   */
  removeImage(id, options){
    const Image = this.app.orm.ProductImage
    let destroy
    let updates

    if (!options) {
      options = {}
    }

    return Image.findById(id,{
      transaction: options.transaction || null
    })
      .then(foundImage => {
        destroy = foundImage
        return Image.findAll({
          where: {
            product_id: destroy.product_id
          },
          transaction: options.transaction || null
        })
      })
      .then(foundImages => {
        updates = _.sortBy(_.filter(foundImages, image => {
          if (image.id !== id){
            return image
          }
        }), 'position')
        _.map(updates, (image, index) => {
          image.position = index + 1
        })
        return Promise.all(updates.map(image => {
          return image.save({
            transaction: options.transaction || null
          })
        }))
      })
      .then(updatedImages => {
        return Image.destroy({
          where: {
            id: id
          },
          transaction: options.transaction || null
        })
      })
  }

  /**
   *
   * @param product
   * @param tag
   * @returns {Promise.<TResult>}
   */
  addTag(product, tag){
    const Product = this.app.orm['Product']
    let resProduct, resTag
    return Product.resolve(product)
      .then(product => {
        if (!product) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resProduct = product
        return this.app.services.TagService.resolve(tag)
      })
      .then(tag => {
        if (!tag) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resTag = tag
        return resProduct.hasTag(resTag.id)
      })
      .then(hasTag => {
        if (!hasTag) {
          return resProduct.addTag(resTag.id)
        }
        return resProduct
      })
      .then(tag => {
        return Product.findByIdDefault(resProduct.id)
      })
  }

  /**
   *
   * @param product
   * @param tag
   * @returns {Promise.<TResult>}
   */
  removeTag(product, tag){
    const Product = this.app.orm['Product']
    let resProduct, resTag
    return Product.resolve(product)
      .then(product => {
        if (!product) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resProduct = product
        return this.app.services.TagService.resolve(tag)
      })
      .then(tag => {
        if (!tag) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resTag = tag
        return resProduct.hasTag(resTag.id)
      })
      .then(hasTag => {
        if (hasTag) {
          return resProduct.removeTag(resTag.id)
        }
        return resProduct
      })
      .then(tag => {
        return Product.findByIdDefault(resProduct.id)
      })
  }

  /**
   *
   * @param product
   * @param association
   * @returns {Promise.<TResult>}
   */
  addAssociation(product, association){
    const Product = this.app.orm['Product']
    let resProduct, resAssociation
    return Product.resolve(product)
      .then(product => {
        if (!product) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resProduct = product
        return Product.resolve(association)
      })
      .then(association => {
        if (!association) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resAssociation = association
        return resProduct.hasAssociation(resAssociation.id)
      })
      .then(hasAssociation => {
        if (!hasAssociation) {
          return resProduct.addAssociation(resAssociation.id)
        }
        return resProduct
      })
      .then(association => {
        return Product.findByIdDefault(resProduct.id)
      })
  }

  /**
   *
   * @param product
   * @param association
   * @returns {Promise.<TResult>}
   */
  removeAssociation(product, association){
    const Product = this.app.orm['Product']
    let resProduct, resAssociation
    return Product.resolve(product)
      .then(product => {
        if (!product) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resProduct = product
        return Product.resolve(association)
      })
      .then(association => {
        if (!association) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resAssociation = association
        return resProduct.hasAssociation(resAssociation.id)
      })
      .then(hasAssociation => {
        if (hasAssociation) {
          return resProduct.removeAssociation(resAssociation.id)
        }
        return resProduct
      })
      .then(association => {
        return Product.findByIdDefault(resProduct.id)
      })
  }

  /**
   *
   * @param product
   * @param collection
   * @returns {Promise.<TResult>}
   */
  addCollection(product, collection){
    const Product = this.app.orm['Product']
    const Collection = this.app.orm['Collection']
    let resProduct, resCollection
    return Product.resolve(product)
      .then(product => {
        if (!product) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resProduct = product
        return Collection.resolve(collection)
      })
      .then(collection => {
        if (!collection) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resCollection = collection
        return resProduct.hasCollection(resCollection.id)
      })
      .then(hasCollection => {
        if (!hasCollection) {
          return resProduct.addCollection(resCollection.id)
        }
        return resProduct
      })
      .then(collection => {
        return Product.findByIdDefault(resProduct.id)
      })
  }

  /**
   *
   * @param product
   * @param collection
   * @returns {Promise.<TResult>}
   */
  removeCollection(product, collection){
    const Product = this.app.orm['Product']
    const Collection = this.app.orm['Collection']
    let resProduct, resCollection
    return Product.resolve(product)
      .then(product => {
        if (!product) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resProduct = product
        return Collection.resolve(collection)
      })
      .then(collection => {
        if (!collection) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resCollection = collection
        return resProduct.hasCollection(resCollection.id)
      })
      .then(hasCollection => {
        if (hasCollection) {
          return resProduct.removeCollection(resCollection.id)
        }
        return resProduct
      })
      .then(collection => {
        return Product.findByIdDefault(resProduct.id)
      })
  }

  /**
   *
   * @param product
   * @param shop
   * @returns {Promise.<TResult>}
   */
  addShop(product, shop){
    const Product = this.app.orm['Product']
    let resProduct, resShop
    return Product.resolve(product)
      .then(product => {
        if (!product) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resProduct = product
        return this.app.services.ShopService.resolve(shop)
      })
      .then(shop => {
        if (!shop) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resShop = shop
        return resProduct.hasShop(resShop.id)
      })
      .then(hasShop => {
        if (!hasShop) {
          return resProduct.addShop(resShop.id)
        }
        return resProduct
      })
      .then(shop => {
        return Product.findByIdDefault(resProduct.id)
      })
  }

  /**
   *
   * @param product
   * @param shop
   * @returns {Promise.<TResult>}
   */
  removeShop(product, shop){
    const Product = this.app.orm['Product']
    let resProduct, resShop
    return Product.resolve(product)
      .then(product => {
        if (!product) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resProduct = product
        return this.app.services.ShopService.resolve(shop)
      })
      .then(shop => {
        if (!shop) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resShop = shop
        return resProduct.hasShop(resShop.id)
      })
      .then(hasShop => {
        if (hasShop) {
          return resProduct.removeShop(resShop.id)
        }
        return resProduct
      })
      .then(shop => {
        return Product.findByIdDefault(resProduct.id)
      })
  }

  /**
   *
   * @param product
   * @param vendor
   * @returns {Promise.<TResult>}
   */
  addVendor(product, vendor){
    const Product = this.app.orm['Product']
    const Vendor = this.app.orm['Vendor']
    let resProduct, resVendor
    return Product.resolve(product)
      .then(product => {
        if (!product) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resProduct = product
        return Vendor.resolve(vendor)
      })
      .then(vendor => {
        if (!vendor) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resVendor = vendor
        return resProduct.hasVendor(resVendor.id)
      })
      .then(hasVendor => {
        if (!hasVendor) {
          return resProduct.addVendor(resVendor.id)
        }
        return resProduct
      })
      .then(vendor => {
        return Product.findByIdDefault(resProduct.id)
      })
  }

  /**
   *
   * @param product
   * @param vendor
   * @returns {Promise.<TResult>}
   */
  removeVendor(product, vendor){
    const Product = this.app.orm['Product']
    const Vendor = this.app.orm['Vendor']
    let resProduct, resVendor
    return Product.resolve(product)
      .then(product => {
        if (!product) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resProduct = product
        return Vendor.resolve(vendor)
      })
      .then(vendor => {
        if (!vendor) {
          throw new Errors.FoundError(Error('Product not found'))
        }
        resVendor = vendor
        return resProduct.hasVendor(resVendor.id)
      })
      .then(hasVendor => {
        if (hasVendor) {
          return resProduct.removeVendor(resVendor.id)
        }
        return resProduct
      })
      .then(vendor => {
        return Product.findByIdDefault(resProduct.id)
      })
  }

  productDefaults(product) {
    // Actual Product Defaults
    if (_.isNil(product.host)) {
      product.host = PRODUCT_DEFAULTS.HOST
    }
    if (_.isNil(product.options)) {
      product.options = PRODUCT_DEFAULTS.OPTIONS
    }
    if (_.isNil(product.tax_code)) {
      product.tax_code = PRODUCT_DEFAULTS.TAX_CODE
    }
    if (_.isNil(product.currency)) {
      product.currency = PRODUCT_DEFAULTS.currency
    }
    if (_.isNil(product.published_scope)) {
      product.published_scope = PRODUCT_DEFAULTS.PUBLISHED_SCOPE
    }
    if (_.isNil(product.published)) {
      product.published = PRODUCT_DEFAULTS.PUBLISHED
    }
    if (_.isNil(product.options)) {
      product.options = PRODUCT_DEFAULTS.options
    }
    if (_.isNil(product.weight)) {
      product.weight = PRODUCT_DEFAULTS.WEIGHT
    }
    if (_.isNil(product.weight_unit)) {
      product.weight_unit = PRODUCT_DEFAULTS.WEIGHT_UNIT
    }
    if (_.isNil(product.tax_code)) {
      product.tax_code = PRODUCT_DEFAULTS.TAX_CODE
    }

    // Variant Defaults for addProduct/updateProduct
    if (_.isNil(product.max_quantity)) {
      product.max_quantity = VARIANT_DEFAULTS.MAX_QUANTITY
    }
    if (_.isNil(product.fulfillment_service)) {
      product.fulfillment_service = VARIANT_DEFAULTS.FULFILLMENT_SERVICE
    }
    if (_.isNil(product.subscription_interval)) {
      product.subscription_interval = VARIANT_DEFAULTS.SUBSCRIPTION_INTERVAL
    }
    if (_.isNil(product.subscription_unit)) {
      product.subscription_unit = VARIANT_DEFAULTS.SUBSCRIPTION_UNIT
    }
    if (_.isNil(product.requires_subscription)) {
      product.requires_subscription = VARIANT_DEFAULTS.REQUIRES_SUBSCRIPTION
    }
    if (_.isNil(product.requires_shipping)) {
      product.requires_shipping = VARIANT_DEFAULTS.REQUIRES_SHIPPING
    }
    if (_.isNil(product.requires_tax)) {
      product.requires_tax = VARIANT_DEFAULTS.REQUIRES_TAX
    }
    if (_.isNil(product.inventory_policy)) {
      product.inventory_policy = VARIANT_DEFAULTS.INVENTORY_POLICY
    }
    if (_.isNil(product.inventory_quantity)) {
      product.inventory_quantity = VARIANT_DEFAULTS.INVENTORY_QUANTITY
    }
    if (_.isNil(product.inventory_management)) {
      product.inventory_management = VARIANT_DEFAULTS.INVENTORY_MANAGEMENT
    }
    if (_.isNil(product.inventory_lead_time)) {
      product.inventory_lead_time = VARIANT_DEFAULTS.INVENTORY_LEAD_TIME
    }
    return product
  }
  /**
   *
   * @param variant
   * @param product
   * @returns {*}
   */
  variantDefaults(variant, product){

    // If the title set on parent
    if (_.isString(product.title) && _.isNil(variant.title)) {
      variant.title = product.title
    }
    // If the price is set on parent
    if (product.price  && !variant.price) {
      variant.price = product.price
    }
    // If the option is set on parent
    if (_.isObject(product.option)  && _.isNil(variant.option)) {
      variant.option = product.option
    }
    // If the barcode is set on parent
    if (_.isString(product.barcode)  && _.isNil(variant.barcode)) {
      variant.barcode = product.barcode
    }
    // If the compare at price is set on parent
    if (_.isNumber(product.compare_at_price)  && _.isNil(variant.compare_at_price)) {
      variant.compare_at_price = product.compare_at_price
    }
    if (_.isNumber(variant.price) && _.isNil(variant.compare_at_price)) {
      variant.compare_at_price = variant.price
    }
    // If the currency set on parent
    if (_.isString(product.currency) && _.isNil(variant.currency)) {
      variant.currency = product.currency
    }
    // If the fulfillment_service is set on parent
    if (_.isString(product.fulfillment_service)  && _.isNil(variant.fulfillment_service)) {
      variant.fulfillment_service = product.fulfillment_service
    }
    // If the requires_shipping is set on parent
    if (_.isBoolean(product.requires_shipping)  && _.isNil(variant.requires_shipping)) {
      variant.requires_shipping = product.requires_shipping
    }
    // If the requires_shipping is set on parent
    if (_.isBoolean(product.requires_tax)  && _.isNil(variant.requires_tax)) {
      variant.requires_tax = product.requires_tax
    }
    // If the requires_subscription set on parent
    if (_.isBoolean(product.requires_subscription) && _.isNil(variant.requires_subscription)) {
      variant.requires_subscription = product.requires_subscription
    }
    // If the subscription_interval set on parent
    if (_.isNumber(product.subscription_interval) && _.isNil(variant.subscription_interval)) {
      variant.subscription_interval = product.subscription_interval
    }
    // If the subscription_unit set on parent
    if (_.isString(product.subscription_unit) && _.isNil(variant.subscription_unit)) {
      variant.subscription_unit = product.subscription_unit
    }
    // If the inventory_tracker set on parent
    if (_.isString(product.inventory_tracker) && _.isNil(variant.inventory_tracker)) {
      variant.inventory_tracker = product.inventory_tracker
    }
    // If the inventory_management set on parent
    if (_.isBoolean(product.inventory_management) && _.isNil(variant.inventory_management)) {
      variant.inventory_management = product.inventory_management
    }
    // If the inventory_quantity set on parent
    if (_.isNumber(product.inventory_quantity) && _.isNil(variant.inventory_quantity)) {
      variant.inventory_quantity = product.inventory_quantity
    }
    // If the inventory_policy set on parent
    if (_.isString(product.inventory_policy) && _.isNil(variant.inventory_policy)) {
      variant.inventory_policy = product.inventory_policy
    }
    // If the max_quantity set on parent
    if (_.isNumber(product.max_quantity) && _.isNil(variant.max_quantity)) {
      variant.max_quantity = product.max_quantity
    }
    // Inherit the product type
    if (_.isString(product.type) && _.isNil(variant.type)) {
      variant.type = product.type
    }
    // If the max_quantity set on parent
    if (_.isString(product.tax_code) && _.isNil(variant.tax_code)) {
      variant.tax_code = product.tax_code
    }
    // If the weight set on parent
    if (_.isNumber(product.weight) && _.isNil(variant.weight)) {
      variant.weight = product.weight
    }
    // If the weight_unit set on parent
    if (_.isString(product.weight_unit) && _.isNil(variant.weight_unit)) {
      variant.weight_unit = product.weight_unit
    }
    return variant
  }

  beforeCreate(product, options) {
    if (product.body) {
      return this.app.services.RenderGenericService.render(product.body)
        .then(doc => {
          product.html = doc.document
          return product
        })
    }
    else {
      return Promise.resolve(product)
    }
  }

  beforeUpdate(product, options) {
    if (product.body) {
      return this.app.services.RenderGenericService.render(product.body)
        .then(doc => {
          product.html = doc.document
          return product
        })
    }
    else {
      return Promise.resolve(product)
    }
  }

  beforeVariantCreate(variant, options) {
    return Promise.resolve(variant)
  }

  beforeVariantUpdate(variant, options) {
    return Promise.resolve(variant)
  }
}

