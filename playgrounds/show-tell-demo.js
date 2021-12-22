'use strict'

const { NOISE } = require('@chainsafe/libp2p-noise')
const dagPB = require('@ipld/dag-pb')
const dns = require('dns')
const { writeFile } = require('fs/promises')
const libp2p = require('libp2p')
const Gossipsub = require('libp2p-gossipsub')
const Multiplex = require('libp2p-mplex')
const TCP = require('libp2p-tcp')
const Websockets = require('libp2p-websockets')
const { Multiaddr } = require('multiaddr')
const { base58btc: base58 } = require('multiformats/bases/base58')
const { CID } = require('multiformats/cid')
const { decode: digestDecode } = require('multiformats/hashes/digest')
const { sha256 } = require('multiformats/hashes/sha2')
const varint = require('varint')
const { request } = require('undici')

const { getPeerId } = require('../src/config')
const { logger, serializeError } = require('../src/logging')
const { Connection } = require('../src/networking')
const { protocols, Entry, Message, WantList } = require('../src/protocol')

// This is needed since index-provider does not use WS (and thus HTTP) which performed DNS CNAME to DNS A automatically.
Multiaddr.resolvers.set('dns4', addr => {
  const host = addr.stringTuples().find(t => t[0] === Multiaddr.protocols.names.dns4.code)[1]

  return new Promise((resolve, reject) => {
    dns.resolve4(host, (err, addresses) => {
      if (err) {
        return reject(err)
      }

      return resolve(addresses.map(a => `/ip4/${a}`))
    })
  })
})

async function setupBitSwap(peerId) {
  const node = await libp2p.create({
    modules: {
      transport: [Websockets],
      streamMuxer: [Multiplex],
      connEncryption: [NOISE]
    }
  })

  const multiaddr = `${process.env.BITSWAP_URL}/ws/p2p/${peerId}`
  logger.info(`Connecting to BitSwap peer ${multiaddr} ...`)
  const dialConnection = await node.dial(multiaddr)
  const { stream, protocol } = await dialConnection.newStream(protocols)
  const duplex = new Connection(dialConnection, stream)
  logger.info('BitSwap is ready.')

  // Handle replies on another stream
  node.handle(protocols, async ({ connection: dialConnection, stream, protocol }) => {
    const connection = new Connection(dialConnection, stream)

    connection.on('data', async data => {
      const decoded = Message.decode(data)
      const blocks = decoded.blocks.length
      const presences = decoded.blockPresences.length

      logger.info(
        {
          blocks,
          presences
        },
        'Received BitSwap response.'
      )

      for (const block of decoded.blocks) {
        let codec = 0x55

        // Check if the content is actually a DAG-PB, in that case we adjust the codec of CID
        try {
          dagPB.decode(block.data)
          codec = dagPB.code
        } catch (e) {
          // No-op
        }

        const c = CID.create(block.prefix[0], codec, await sha256.digest(block.data))

        await writeFile(`tmp/${c.toString()}`, block.data)
        logger.info(`Written block tmp/${c.toString()}.`)
      }
    })

    connection.on('error', error => {
      logger.error({ error }, `Connection error: ${serializeError(error)}`)
    })
  })

  return { duplex, protocol }
}

async function setupGossipsub(peerId, bitswap, protocol) {
  const providerUrl = process.env.PROVIDER_URL

  const node = await libp2p.create({
    modules: {
      transport: [TCP],
      streamMuxer: [Multiplex],
      connEncryption: [NOISE]
    }
  })

  const gsub = new Gossipsub(node, {
    directPeers: [
      {
        id: peerId,
        addrs: [new Multiaddr(providerUrl)]
      }
    ]
  })

  gsub.on('indexer/ingest', async data => {
    try {
      const [cid, rest] = CID.decodeFirst(data.data)
      const cidString = cid.toString()

      // Decode the rest of the message to see who holds the data
      const length = varint.decode(rest)
      const start = varint.decode.bytes
      const multiaddr = new Multiaddr(rest.slice(start, start + length))
      const isHttps = multiaddr.protoNames().includes('https')
      const url = new URL(`http${isHttps ? 's' : ''}://${multiaddr.toOptions().host}`)

      // Fetch the advertisement contents
      url.pathname = cid.toString()
      let { body } = await request(url)

      logger.info({ cid: cidString, url }, 'Received advertisement, asking for its contents ...')

      let response = Buffer.alloc(0)
      for await (const chunk of body) {
        response = Buffer.concat([response, chunk])
      }

      const contents = JSON.parse(response.toString('utf-8'))
      const entriesCid = contents.Entries['/']

      // Fetch the entries contents
      url.pathname = entriesCid
      logger.info(
        { cid: cidString, entriescid: cidString, url },
        'Received advertisement contents, fetching the list of multihashes...'
      )

      body = (await request(url)).body
      response = Buffer.alloc(0)
      for await (const chunk of body) {
        response = Buffer.concat([response, chunk])
      }

      const entries = JSON.parse(response.toString('utf-8')).map(e =>
        base58.encode(Buffer.from(e['/'].bytes, 'base64'))
      )

      logger.info({ cid: cidString, entries }, 'Received entries.')

      // Now fetch all entries via BitSwap
      bitswap.send(
        new Message(
          new WantList(
            entries.map(e => {
              /*
                Not all blocks are raw, but since we only deal with multihashes, we have no way
                to get the codec back.
                In the saving phase we will attempt a decode to get the original format back.
              */
              const c = CID.create(1, 0x55, digestDecode(base58.decode(e)))
              return new Entry(c, 1, false, Entry.WantType.Block, true)
            }),
            false
          ),
          [],
          [],
          0
        ).encode(protocol)
      )
    } catch (error) {
      logger.error({ error }, `Error occurred: ${serializeError(error)}`)
    }
  })

  // Start Gossipsub
  logger.info(`Connecting to Gossipsub on ${providerUrl} ...`)
  await gsub.start()
  gsub.subscribe('indexer/ingest')
  logger.info("We're now listening for advertisements ...")
}

async function client() {
  const peerId = await getPeerId()
  const { duplex, protocol } = await setupBitSwap(peerId)

  await setupGossipsub(peerId, duplex, protocol)
}

client()
