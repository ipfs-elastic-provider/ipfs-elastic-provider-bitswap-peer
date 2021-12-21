'use strict'

const { NOISE } = require('@chainsafe/libp2p-noise')
const { readFileSync } = require('fs')
const libp2p = require('libp2p')
const Multiplex = require('libp2p-mplex')
const Websockets = require('libp2p-websockets')
const { CID } = require('multiformats/cid')

const { getPeerId, port } = require('../src/config')
const { logger, elapsed } = require('../src/logging')
const { Connection } = require('../src/networking')
const { BITSWAP_V_120, Entry, Message, WantList } = require('../src/protocol')

const allCids = readFileSync(process.argv[3], 'utf-8')
  .split('\n')
  .map(c => CID.parse(c))

const protocol = BITSWAP_V_120

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
  console.log("*** Node dial..")
  const connection = await node.dial(multiaddr)
  console.log("***** After dial")
  logger.info(`Connected in ${elapsed(start)} ms.`)

  const { stream } = await connection.newStream(protocol)
  const duplex = new Connection(stream)

  let dataReceived = 0
  let toReceive = allCids.length

  logger.info('Stream is ready.')

  // Start communication
  start = process.hrtime.bigint()
  let current = 0
  duplex.on('data', async data => {
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
        blocks: decoded.blocks.length,
        presences: decoded.blockPresences.length,
        pending: toReceive
      },
      'Received response.'
    )

    if (toReceive <= 0) {
      logger.info('All data received, closing the connection.')
      await connection.close()
    }
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
