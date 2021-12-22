'use strict'

const { EventEmitter } = require('events')
const lengthPrefixedMessage = require('it-length-prefixed')
const pipe = require('it-pipe')
const { setTimeout: sleep } = require('timers/promises')
const { logger, serializeError } = require('./logging')

class Connection extends EventEmitter {
  constructor(dial, stream) {
    super()

    this.dial = dial
    this.done = false
    this.values = []
    this.resolves = []

    // Prepare for receiving
    pipe(stream.source, lengthPrefixedMessage.decode(), async source => {
      for await (const data of source) {
        process.nextTick(() => this.emit('data', data.slice()))
      }
    }).catch(error => {
      this.emit('error', error)
      this.emit('error:receive', error)
      logger.error({ error }, `Cannot receive data: ${serializeError(error)}`)
    })

    // Prepare for sending
    pipe(this, lengthPrefixedMessage.encode(), stream.sink)
      // Autoclean up idle connections
      .then(() => sleep(30000))
      .then(() =>
        // Closing
        this.dial.close().catch(() => {})
      )
      .catch(error => {
        this.emit('error', error)
        this.emit('error:send', error)

        logger.error({ error }, `Cannot send data: ${serializeError(error)}`)
      })
  }

  send(value) {
    if (this.done) {
      throw new Error('The stream is closed.')
    }

    const resolve = this.resolves.shift()

    if (resolve) {
      return resolve({ done: false, value })
    }

    this.values.push(value)
  }

  close() {
    this.done = true

    for (const resolve of this.resolves) {
      resolve({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        // Marked as done, exit without processing additional values
        if (this.done) {
          return Promise.resolve({ done: true, value: undefined })
        }

        // There is a value in the queue, return it
        const value = this.values.shift()

        if (value) {
          return Promise.resolve({ done: false, value })
        }

        // Return a new pending promise that it will be fulfilled as soon as value is available
        return new Promise(resolve => this.resolves.push(resolve))
      }
    }
  }
}

module.exports = { Connection }
