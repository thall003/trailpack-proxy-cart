/* eslint no-console: [0] */
'use strict'

const Controller = require('trails/controller')
const Errors = require('proxy-engine-errors')
const lib = require('../../lib')
/**
 * @module CollectionController
 * @description Generated Trails.js Controller.
 */
module.exports = class CollectionController extends Controller {
  /**
   *
   * @param req
   * @param res
   */
  count(req, res){
    const ProxyEngineService = this.app.services.ProxyEngineService
    ProxyEngineService.count('Collection')
      .then(count => {
        const counts = {
          collections: count
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
  findById(req, res){
    const orm = this.app.orm
    const Collection = orm['Collection']
    Collection.findByIdDefault(req.params.id, {})
      .then(collection => {
        if (!collection) {
          throw new Errors.FoundError(Error(`Collection id ${ req.params.id } not found`))
        }
        return res.json(collection)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }

  findByHandle(req, res){
    const orm = this.app.orm
    const Collection = orm['Collection']
    Collection.findByHandle(req.params.handle)
      .then(collection => {
        if (!collection) {
          throw new Errors.FoundError(Error(`Collection handle ${ req.params.handle } not found`))
        }
        return res.json(collection)
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
  findOne(req, res){
    const orm = this.app.orm
    const Collection = orm['Collection']
    const where = this.app.services.ProxyCartService.jsonCritera(req.query.where)

    Collection.findOneDefault({
      where: where
    })
      .then(collection => {
        return res.json(collection)
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
    const Collection = orm['Collection']
    const limit = req.query.limit || 10
    const offset = req.query.offset || 0
    const sort = req.query.sort || 'created_at DESC'
    const where = this.app.services.ProxyCartService.jsonCritera(req.query.where)
    Collection.findAndCountDefault({
      where: where,
      order: sort,
      offset: offset,
      limit: limit
    })
      .then(collections => {
        const pages = Math.ceil(collections.count / limit) == 0 ? 1 : Math.ceil(collections.count / limit)
        const page = offset == 0 ? 1 : Math.round(offset / limit)
        res.set('X-Pagination-Total', collections.count)
        res.set('X-Pagination-Pages', pages)
        res.set('X-Pagination-Page', page)
        res.set('X-Pagination-Offset', offset)
        res.set('X-Pagination-Limit', limit)
        res.set('X-Pagination-Sort', sort)
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
  search(req, res){
    const orm = this.app.orm
    const Collection = orm['Collection']
    const limit = req.query.limit || 10
    const offset = req.query.offset || 0
    const sort = req.query.sort || 'created_at DESC'
    const term = req.query.term
    Collection.findAndCountDefault({
      where: {
        $or: [
          {
            title: {
              $like: `%${term}%`
            }
          }
        ]
      },
      order: sort,
      offset: offset,
      limit: limit
    })
      .then(collections => {
        const pages = Math.ceil(collections.count / limit) == 0 ? 1 : Math.ceil(collections.count / limit)
        const page = offset == 0 ? 1 : Math.round(offset / limit)
        res.set('X-Pagination-Total', collections.count)
        res.set('X-Pagination-Pages', pages)
        res.set('X-Pagination-Page', page)
        res.set('X-Pagination-Offset', offset)
        res.set('X-Pagination-Limit', limit)
        res.set('X-Pagination-Sort', sort)
        return res.json(collections.rows)
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
    const CollectionService = this.app.services.CollectionService
    console.log(req.body)
    lib.Validator.validateCollection.create(req.body)
      .then(values => {
        return CollectionService.create(req.body)
      })
      .then(collection => {
        return res.json(collection)
      })
      .catch(err => {
        // console.log('CollectionController.create', err)
        return res.serverError(err)
      })

  }

  /**
   *
   * @param req
   * @param res
   */
  update(req, res) {
    const CollectionService = this.app.services.CollectionService
    lib.Validator.validateCollection.update(req.body)
      .then(values => {
        req.body.id = req.params.id
        return CollectionService.update(req.body)
      })
      .then(collection => {
        return res.json(collection)
      })
      .catch(err => {
        // console.log('CollectionController.update', err)
        return res.serverError(err)
      })
  }

  /**
   * upload CSV
   * @param req
   * @param res
   */
  uploadCSV(req, res) {
    const CollectionCsvService = this.app.services.CollectionCsvService
    const csv = req.file

    if (!csv) {
      const err = new Error('File failed to upload')
      return res.serverError(err)
    }

    CollectionCsvService.collectionCsv(csv.path)
      .then(result => {
        // console.log('CollectionController.uploadCSV',result)
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
    const CollectionCsvService = this.app.services.CollectionCsvService
    CollectionCsvService.processCollectionUpload(req.params.id)
      .then(result => {
        return res.json(result)
      })
      .catch(err => {
        return res.serverError(err)
      })
  }
}

