'use strict'

require('dotenv').config()
const PeerId = require('peer-id')
const { readFile } = require('fs/promises')
const { join } = require('path')

const {
  CACHE_BLOCKS_INFO: cacheBlocksInfo,
  CONCURRENCY: rawConcurrency,
  DYNAMO_BLOCKS_TABLE: blocksTable,
  DYNAMO_CARS_TABLE: carsTable,
  PEER_ID_FILE: peerIdJsonPath,
  PORT: rawPort
} = process.env

async function getPeerId() {
  try {
    console.log(process.env.PEER_ID_FILE)
    console.log(join(__dirname, '..', peerIdJsonPath))
    const peerIdJson = JSON.parse(await readFile(join(__dirname, '..', peerIdJsonPath), 'utf-8'))
    return await PeerId.createFromJSON(peerIdJson)
  } catch (e) {
    return PeerId.create()
  }
}

const concurrency = parseInt(rawConcurrency)
const port = parseInt(rawPort)

module.exports = {
  cacheBlocksInfo: cacheBlocksInfo !== 'false',
  concurrency: !isNaN(concurrency) && concurrency > 0 ? concurrency : 16,
  blocksTable: blocksTable ?? 'blocks',
  carsTable: carsTable ?? 'cars',
  getPeerId,
  primaryKeys: {
    blocks: 'multihash',
    cars: 'path'
  },
  port: !isNaN(port) && port > 0 ? port : 0
}
