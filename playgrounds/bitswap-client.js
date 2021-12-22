'use strict'

const { NOISE } = require('@chainsafe/libp2p-noise')
const { readFileSync } = require('fs')
const libp2p = require('libp2p')
const Multiplex = require('libp2p-mplex')
const Websockets = require('libp2p-websockets')
const { CID } = require('multiformats/cid')

const { getPeerId, port } = require('../src/config')
const { logger, elapsed, serializeError } = require('../src/logging')
const { Connection } = require('../src/networking')
const { protocols, Entry, Message, WantList } = require('../src/protocol')

const allCids = readFileSync(process.argv[3], 'utf-8')
  .split('\n')
  .map(c => c.trim())
  .filter(c => c)
  .map(c => CID.parse(c))

async function client() {
  let start = process.hrtime.bigint()
  const peerId = await getPeerId()

  const node = await libp2p.create({
    modules: {
      transport: [Websockets],
      streamMuxer: [Multiplex],
      connEncryption: [NOISE]
    }
  })

  // Connect to the BitSwap peer
  const multiaddr = `/dns4/${process.argv[2]}/tcp/${port}/ws/p2p/${peerId}`
  logger.info(`Connecting to ${multiaddr} ...`)
  const dialConnection = await node.dial(multiaddr)
  logger.info(`Connected in ${elapsed(start)} ms.`)

  const { stream, protocol } = await dialConnection.newStream(protocols)
  const duplex = new Connection(dialConnection, stream)

  let dataReceived = 0
  let toReceive = allCids.length

  logger.info('Stream is ready.')

  // Start communication
  start = process.hrtime.bigint()
  let current = 0

  node.handle(protocols, async ({ connection: dialConnection, stream, protocol }) => {
    const connection = new Connection(dialConnection, stream)

    connection.on('data', async data => {
      const decoded = Message.decode(data)
      const blocks = decoded.blocks.length
      const presences = decoded.blockPresences.length

      // Update stats
      current++
      toReceive -= blocks + presences
      dataReceived += data.length

      logger.info(
        {
          timing: elapsed(start),
          current: current,
          currentSize: data.length,
          totalSize: dataReceived,
          blocks,
          presences,
          pending: toReceive
        },
        'Received response.'
      )

      if (toReceive <= 0) {
        logger.info('All data received, closing the connection.')
        await dialConnection.close()
      }
    })

    connection.on('error', error => {
      logger.error({ error }, `Connection error: ${serializeError(error)}`)
    })
  })

  // Send the only request
  duplex.send(
    new Message(
      new WantList(
        allCids.map(c => new Entry(c, 1, false, Entry.WantType.Block, true)),
        false
      ),
      [],
      [],
      0
    ).encode(protocol)
  )

  logger.info('Request sent.')
}

client()
