'use strict'
/* global describe, it */
const assert = require('assert')
const moment = require('moment')

describe('Subscription Model', () => {
  let Subscription
  it('should exist', () => {
    assert(global.app.api.services['SubscriptionService'])
    Subscription = global.app.services.ProxyEngineService.getModel('Subscription')
    assert(Subscription)
  })
  it('should resolve a subscription instance', (done) => {
    Subscription.resolve(Subscription.build({}))
      .then(subscription => {
        assert.ok(subscription instanceof Subscription.Instance)
        done()
      })
      .catch(err => {
        done(err)
      })
  })
  it('should renew a subscription instance', (done) => {
    const start = moment().startOf('hour').format('YYYY-MM-DD HH:mm:ss')
    const end = moment().startOf('hour').add(1,'months').format('YYYY-MM-DD HH:mm:ss')
    Subscription.build({
      customer_id: 1,
      renewed_at: start,
      interval: 1,
      interval_unit: 'm'
    }).renew().save()
      .then(subscription => {
        // console.log('MODEL renew', subscription)
        assert.ok(subscription instanceof Subscription.Instance)
        assert.ok(subscription.renews_on)
        assert.equal(subscription.active, true)
        done()
      })
      .catch(err => {
        done(err)
      })
  })

  it('should retry a subscription instance', (done) => {
    const start = moment().startOf('hour').format('YYYY-MM-DD HH:mm:ss')
    const end = moment().startOf('hour').add(1,'months').format('YYYY-MM-DD HH:mm:ss')
    Subscription.build({
      customer_id: 1,
      renewed_at: start,
      interval: 1,
      interval_unit: 'm'
    }).retry().save()
      .then(subscription => {
        // console.log('MODEL renew', subscription)
        assert.ok(subscription instanceof Subscription.Instance)
        assert.equal(subscription.active, true)
        assert.ok(subscription.renews_on)
        assert.ok(subscription.renew_retry_at)
        assert.equal(subscription.total_renewal_attempts, 1)
        // assert.equal(subscription.renews_on, end)
        done()
      })
      .catch(err => {
        done(err)
      })
  })
})
