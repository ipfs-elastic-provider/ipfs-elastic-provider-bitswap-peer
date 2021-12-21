'use strict'

require('make-promises-safe')

const { writeFile } = require('fs/promises')
const { join } = require('path')

const { logger } = require('./logging')
const { startService } = require('./service')
const { startMetricsEndpoint } = require('./prometheus-exporter')
const { fetchS3Object } = require('./storage')
const { start } = require('repl')

async function downloadPeerIdFile() {
  const contents = await fetchS3Object(process.env.PEER_ID_S3_BUCKET, process.env.PEER_ID_FILE)
  return writeFile(join(__dirname, '..', process.env.PEER_ID_FILE), contents)
}

async function main() {
  try {
    const before = (await process.env.PEER_ID_S3_BUCKET) ? downloadPeerIdFile() : Promise.resolve()
    let meter = await startMetricsEndpoint()
    startService(null, meter)
  } catch {
    logger.error.bind(logger)
  }
}

main()