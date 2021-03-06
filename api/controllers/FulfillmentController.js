'use strict'

const Controller = require('trails/controller')
const Errors = require('proxy-engine-errors')

/**
 * @module FulfillmentController
 * @description Fulfillment Controller.
 */
module.exports = class FulfillmentController extends Controller {
  /**
   *
   * @param req
   * @param res
   */
  generalStats(req, res) {
    res.json({})
  }

  /**
   * Find One By ID
   * @param req
   * @param res
   */
  findById(req, res) {
    const Fulfillment = this.app.orm['Fulfillment']
    const id = req.params.id

    Fulfillment.findByIdDefault(id, {})
      .then(fulfillment => {
        if (!fulfillment) {
          throw new Errors.FoundError(Error(`Fulfillment id ${id} not found`))
        }
        return res.json(fulfillment)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }
  /**
   * Count the amount of fulfillments
   * @param req
   * @param res
   */
  count(req, res){
    const ProxyEngineService = this.app.services.ProxyEngineService
    ProxyEngineService.count('Fulfillment')
      .then(count => {
        const counts = {
          fulfillments: count
        }
        return res.json(counts)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }

  /**
   * Find All Fulfillments
   * @param req
   * @param res
   */
  findAll(req, res) {
    const orm = this.app.orm
    const Fulfillment = orm['Fulfillment']
    const limit = req.query.limit || 10
    const offset = req.query.offset || 0
    const sort = req.query.sort || 'created_at DESC'
    const where = this.app.services.ProxyCartService.jsonCritera(req.query.where)

    Fulfillment.findAndCount({
      order: sort,
      offset: offset,
      limit: limit,
      where: where
    })
      .then(fulfillments => {
        this.app.services.ProxyEngineService.paginate(res, fulfillments.count, limit, offset, sort)
        return res.json(fulfillments.rows)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }

  /**
   * Create Fulfillment
   * @param req
   * @param res
   */
  create(req, res) {
    // TODO
  }

  /**
   * Update Fulfillment
   * @param req
   * @param res
   */
  update(req, res) {
    // TODO
  }

  /**
   * Destroy Fulfillment
   * @param req
   * @param res
   */
  destroy(req, res) {
    // TODO
  }
}

