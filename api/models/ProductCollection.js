'use strict'

const Model = require('trails/model')

/**
 * @module ProductCollection
 * @description Product Collection Model
 */
module.exports = class ProductCollection extends Model {

  static config (app, Sequelize) {
    let config = {}
    if (app.config.database.orm === 'sequelize') {
      config = {
        options: {
          underscored: true,
          classMethods: {
            associate: (models) => {
              models.ProductCollection.hasMany(models.Product, {
                as: 'products'
              })
              models.ProductCollection.hasMany(models.ProductImage, {
                as: 'images'
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
        handle: {
          type: Sequelize.STRING
        },
        // Multi Site Support
        host: {
          type: Sequelize.STRING,
          defaultValue: 'localhost'
        },
        body: {
          type: Sequelize.TEXT
        },
        published: {
          type: Sequelize.BOOLEAN
        },
        published_at: {
          type: Sequelize.DATE
        },
        published_scope: {
          type: Sequelize.STRING
        },
        unpublished_at: {
          type: Sequelize.DATE
        },
        title: {
          type: Sequelize.STRING
        },
        live_mode: {
          type: Sequelize.BOOLEAN,
          defaultValue: false
        }
      }
    }
    return schema
  }
}
