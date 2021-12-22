'use strict'

const { NOISE } = require('@chainsafe/libp2p-noise')
const dagPB = require('@ipld/dag-pb')
const { EventEmitter } = require('events')
const libp2p = require('libp2p')
const Multiplex = require('libp2p-mplex')
const Websockets = require('libp2p-websockets')
const { CID } = require('multiformats/cid')
const { equals } = require('multiformats/hashes/digest')
const { sha256 } = require('multiformats/hashes/sha2')
const getPort = require('get-port')
const { startService } = require('../src/service')
const { RawMessage, Message } = require('../src/protocol')
const { Connection } = require('../src/networking')

// TODO: Write a script to regenerate this data
// cid1 and cid2 exists, the other two don't
const cid1 = CID.parse('bafkreifiqpnpysanizxoatqnnwuynply5mp52ily2bdjg4r5uoupsxkc6q')
const cid2 = CID.parse('bafybeigt3wlrvzpanhazlpumeoz2ya4tmkrjhaq6ulvlbw5y4hlfzhidvm')
const cid3 = CID.parse('bafybeiccfclkdtucu6y4yc5cpr6y3yuinr67svmii46v5cfcrkp47ihehy')
const cid4 = CID.parse('bafybeihfg3d7rdltd43u3tfvncx7n5loqofbsobojcadtmokrljfthuc7y')

// cid5, cid6 and cid7 are 1.5MB each so they will be splitted, cid8 is over 2 MB so it's never sent back
const cid5 = CID.parse('bafybeihrhjop5qhy6tslhif7syf2tt4w4ep64s3js6uvkxbc3uh7eyjqb4')
const cid6 = CID.parse('bafybeiaibrkkzprkrf57thqigc47le4eae2ebenw54eqpw2t4t2s6b5jfa')
const cid7 = CID.parse('bafybeigyqajar5t7vdqgvpjl4o33yhdqshetco2hswe5ntb33w7c33iqtu')
const cid8 = CID.parse('bafybeifrw4nujkykejl5ryu3xweroao734ekcomygfmht6x2pyggwmjfmm')

// cid9 is 500 byte less than the block limit
const cid9 = CID.parse('bafkreibs35lqy5ocdveorpyw7sirzuzue5nonhejvpzzvct24bqzjz42eq')

let currentPort = 53000 + parseInt(process.env.TAP_CHILD_ID) * 100

async function createClient(peerId, port, protocol) {
  const node = await libp2p.create({
    modules: {
      transport: [Websockets],
      streamMuxer: [Multiplex],
      connEncryption: [NOISE]
    }
  })

  const connection = await node.dial(`/ip4/127.0.0.1/tcp/${port}/ws/p2p/${peerId}`)
  const { stream } = await connection.newStream(protocol)
  const receiver = new EventEmitter()

  node.handle(protocol, async ({ connection: dialConnection, stream, protocol }) => {
    const connection = new Connection(dialConnection, stream)

    connection.on('data', data => {
      receiver.emit('message', data)
    })
  })

  return { connection, stream, receiver }
}

async function prepare(protocol) {
  const port = await getPort({ port: currentPort++ })

  const { peerId, service } = await startService(port)
  const { connection: client, stream, receiver } = await createClient(peerId, port, protocol)

  const connection = new Connection(client, stream)

  return { service, client, connection, receiver }
}

async function receiveMessages(receiver, protocol, timeout = 5000, limit = 1, raw = false) {
  let timeoutHandle
  const responses = []

  return new Promise((resolve, reject) => {
    let resolved = false

    timeoutHandle = setTimeout(() => {
      if (resolved) {
        return
      }

      resolved = true
      resolve(responses)
    }, timeout)

    // Return all the response we receive in a certain timeout
    receiver.on('message', message => {
      if (resolved) {
        return
      }

      try {
        responses.push(raw ? RawMessage.decode(message) : Message.decode(message, protocol))

        if (responses.length === limit) {
          resolved = true
          resolve(responses)
        }
      } catch (e) {
        resolved = true
        reject(e)
      }
    })
  }).finally(() => {
    clearTimeout(timeoutHandle)
    receiver.removeAllListeners('message')
  })
}

function getPresence(t, response, cid) {
  const presences = response.blockPresences.filter(b => b.cid.equals(cid))

  t.equal(presences.length, 1)

  return presences[0]
}

function hasSingleDAGBlock(t, response, link) {
  const found = response.blocks.filter(b => safeGetDAGLinks(b)?.[0].Name === link)

  t.equal(found.length, 1)
}

function hasSingleRawBlock(t, response, content) {
  const blocks = response.blocks.filter(b => b.data.toString() === content)

  t.equal(blocks.length, 1)
}

async function hasSingleBlockWithHash(t, response, multihash, hasNot) {
  const hashes = await Promise.all(response.blocks.map(b => sha256.digest(b.data)))

  t.equal(hashes.filter(h => equals(h, multihash)).length, hasNot ? 0 : 1)
}

function safeGetDAGLinks(block) {
  try {
    return Object.values(dagPB.decode(Buffer.isBuffer(block) ? block : block.data).Links)
  } catch (e) {
    return [{}]
  }
}

module.exports = {
  cid1,
  cid2,
  cid3,
  cid4,
  cid5,
  cid6,
  cid7,
  cid8,
  cid9,
  cid1Content: '1234\n',
  cid2Link: 'abc',
  getPresence,
  hasSingleDAGBlock,
  hasSingleRawBlock,
  hasSingleBlockWithHash,
  prepare,
  receiveMessages,
  safeGetDAGLinks
}
