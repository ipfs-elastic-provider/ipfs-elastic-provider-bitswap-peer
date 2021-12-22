'use strict'

const t = require('tap')
const { BITSWAP_V_120: protocol, BlockPresence, Entry, Message, WantList } = require('../src/protocol')
const {
  cid1,
  cid2,
  cid3,
  cid4,
  cid5,
  cid6,
  cid7,
  cid8,
  cid9,
  cid1Content,
  cid2Link,
  getPresence,
  hasSingleDAGBlock,
  hasSingleRawBlock,
  hasSingleBlockWithHash,
  prepare,
  receiveMessages,
  safeGetDAGLinks
} = require('./utils')

t.test(`${protocol} - uses the right fields when serializing and deserializing`, async t => {
  t.plan(16)

  const wantList = new WantList(
    [
      new Entry(cid1, 1, false, Entry.WantType.Have, true),
      new Entry(cid2, 1, false, Entry.WantType.Block, true),
      new Entry(cid3, 1, false, Entry.WantType.Have, true),
      new Entry(cid4, 1, false, Entry.WantType.Block, true)
    ],
    false
  )

  const request = new Message(wantList, [], [], 0)
  const encoded = request.serialize(protocol)

  const entry = encoded.wantlist.entries[0]
  t.strictSame(Object.keys(entry), ['block', 'priority', 'cancel', 'wantType', 'sendDontHave'])
  t.equal(entry.block[0], 0x01)
  t.equal(entry.block[1], 0x55)
  t.equal(entry.block[2], 0x12)
  t.equal(entry.block[3], 0x20)

  const { client, service, connection, receiver } = await prepare(protocol)
  await connection.send(request.encode(protocol))
  const [response] = await receiveMessages(receiver, protocol, 5000, 1, true)
  await client.close()
  await service.stop()

  const cid2Blocks = response.payload.filter(p => p.prefix.equals(Buffer.from([0x01, 0x70, 0x12, 0x20])))
  const cid1Presences = response.blockPresences.filter(b => b.cid.equals(cid1.bytes))
  const cid3Presences = response.blockPresences.filter(b => b.cid.equals(cid3.bytes))
  const cid4Presences = response.blockPresences.filter(b => b.cid.equals(cid4.bytes))

  t.equal(response.blocks.length, 0)
  t.equal(response.payload.length, 1)
  t.equal(response.blockPresences.length, 3)

  t.equal(cid2Blocks.length, 1)
  t.equal(safeGetDAGLinks(cid2Blocks[0])?.[0].Name, cid2Link)

  t.equal(cid1Presences.length, 1)
  t.equal(cid1Presences[0].type, BlockPresence.Type.Have)
  t.equal(cid3Presences.length, 1)
  t.equal(cid3Presences[0].type, BlockPresence.Type.DontHave)
  t.equal(cid4Presences.length, 1)
  t.equal(cid4Presences[0].type, BlockPresence.Type.DontHave)
})

t.test(`${protocol} - type=Mixed - cancel=true - no response received`, async t => {
  t.plan(1)

  const { client, service, connection, receiver } = await prepare(protocol)

  const wantList = new WantList(
    [
      new Entry(cid1, 1, true, Entry.WantType.Have, true),
      new Entry(cid2, 1, true, Entry.WantType.Block, true),
      new Entry(cid3, 1, true, Entry.WantType.Have, true),
      new Entry(cid4, 1, true, Entry.WantType.Block, true)
    ],
    false
  )

  const request = new Message(wantList, [], [], 0)
  await connection.send(request.encode(protocol))

  const responses = await receiveMessages(receiver, protocol)
  await client.close()
  await service.stop()

  t.equal(responses.length, 0)
})

t.test(
  `${protocol} - type=Block - sendDontHave=true - 2 hits / 2 misses - 2 blocks / 2 negative presences received`,
  async t => {
    t.plan(8)

    const { client, service, connection, receiver } = await prepare(protocol)

    const wantList = new WantList(
      [
        new Entry(cid1, 1, false, Entry.WantType.Block, true),
        new Entry(cid2, 1, false, Entry.WantType.Block, true),
        new Entry(cid3, 1, false, Entry.WantType.Block, true),
        new Entry(cid4, 1, false, Entry.WantType.Block, true)
      ],
      false
    )

    const request = new Message(wantList, [], [], 0)
    await connection.send(request.encode(protocol))

    const [response] = await receiveMessages(receiver, protocol)
    await client.close()
    await service.stop()

    t.equal(response.blocks.length, 2)
    t.equal(response.blockPresences.length, 2)

    hasSingleRawBlock(t, response, cid1Content)
    hasSingleDAGBlock(t, response, cid2Link)

    t.equal(getPresence(t, response, cid3).type, BlockPresence.Type.DontHave)
    t.equal(getPresence(t, response, cid4).type, BlockPresence.Type.DontHave)
  }
)

t.test(`${protocol} - type=Block - sendDontHave=false - 2 hits / 2 misses - 2 blocks received`, async t => {
  t.plan(4)

  const { client, service, connection, receiver } = await prepare(protocol)

  const wantList = new WantList(
    [
      new Entry(cid1, 1, false, Entry.WantType.Block, false),
      new Entry(cid2, 1, false, Entry.WantType.Block, false),
      new Entry(cid3, 1, false, Entry.WantType.Block, false),
      new Entry(cid4, 1, false, Entry.WantType.Block, false)
    ],
    false
  )

  const request = new Message(wantList, [], [], 0)
  await connection.send(request.encode(protocol))

  const [response] = await receiveMessages(receiver, protocol)
  await client.close()
  await service.stop()

  t.equal(response.blocks.length, 2)
  t.equal(response.blockPresences.length, 0)

  hasSingleRawBlock(t, response, cid1Content)
  hasSingleDAGBlock(t, response, cid2Link)
})

t.test(
  `${protocol} - type=Have - sendDontHave=true - 2 hits / 2 misses - 2 positive presences / 2 negative presences received`,
  async t => {
    t.plan(10)

    const { client, service, connection, receiver } = await prepare(protocol)

    const wantList = new WantList(
      [
        new Entry(cid1, 1, false, Entry.WantType.Have, true),
        new Entry(cid2, 1, false, Entry.WantType.Have, true),
        new Entry(cid3, 1, false, Entry.WantType.Have, true),
        new Entry(cid4, 1, false, Entry.WantType.Have, true)
      ],
      false
    )

    const request = new Message(wantList, [], [], 0)
    await connection.send(request.encode(protocol))

    const [response] = await receiveMessages(receiver, protocol)
    await client.close()
    await service.stop()

    t.equal(response.blocks.length, 0)
    t.equal(response.blockPresences.length, 4)

    t.equal(getPresence(t, response, cid1).type, BlockPresence.Type.Have)
    t.equal(getPresence(t, response, cid2).type, BlockPresence.Type.Have)
    t.equal(getPresence(t, response, cid3).type, BlockPresence.Type.DontHave)
    t.equal(getPresence(t, response, cid4).type, BlockPresence.Type.DontHave)
  }
)

t.test(`${protocol} - type=Have - sendDontHave=false - 2 hits / 2 misses - 2 positive presences received`, async t => {
  t.plan(6)

  const { client, service, connection, receiver } = await prepare(protocol)

  const wantList = new WantList(
    [
      new Entry(cid1, 1, false, Entry.WantType.Have, false),
      new Entry(cid2, 1, false, Entry.WantType.Have, false),
      new Entry(cid3, 1, false, Entry.WantType.Have, false),
      new Entry(cid4, 1, false, Entry.WantType.Have, false)
    ],
    false
  )

  const request = new Message(wantList, [], [], 0)
  await connection.send(request.encode(protocol))

  const [response] = await receiveMessages(receiver, protocol)
  await client.close()
  await service.stop()

  t.equal(response.blocks.length, 0)
  t.equal(response.blockPresences.length, 2)

  t.equal(getPresence(t, response, cid1).type, BlockPresence.Type.Have)
  t.equal(getPresence(t, response, cid2).type, BlockPresence.Type.Have)
})

t.test(
  `${protocol} - type=Mixed - sendDontHave=true - 2 hits / 2 misses - 1 block / 1 positive presences / 2 negative presences received`,
  async t => {
    t.plan(9)

    const { client, service, connection, receiver } = await prepare(protocol)

    const wantList = new WantList(
      [
        new Entry(cid1, 1, false, Entry.WantType.Have, true),
        new Entry(cid2, 1, false, Entry.WantType.Block, true),
        new Entry(cid3, 1, false, Entry.WantType.Have, true),
        new Entry(cid4, 1, false, Entry.WantType.Block, true)
      ],
      false
    )

    const request = new Message(wantList, [], [], 0)
    await connection.send(request.encode(protocol))

    const [response] = await receiveMessages(receiver, protocol)
    await client.close()
    await service.stop()

    t.equal(response.blocks.length, 1)
    t.equal(response.blockPresences.length, 3)

    hasSingleDAGBlock(t, response, cid2Link)

    t.equal(getPresence(t, response, cid1).type, BlockPresence.Type.Have)
    t.equal(getPresence(t, response, cid3).type, BlockPresence.Type.DontHave)
    t.equal(getPresence(t, response, cid4).type, BlockPresence.Type.DontHave)
  }
)

t.test(
  `${protocol} - type=Mixed - sendDontHave=false - 2 hits / 2 misses - 1 block / 1 positive presence received`,
  async t => {
    t.plan(5)

    const { client, service, connection, receiver } = await prepare(protocol)

    const wantList = new WantList(
      [
        new Entry(cid1, 1, false, Entry.WantType.Have, false),
        new Entry(cid2, 1, false, Entry.WantType.Block, false),
        new Entry(cid3, 1, false, Entry.WantType.Have, false),
        new Entry(cid4, 1, false, Entry.WantType.Block, false)
      ],
      false
    )

    const request = new Message(wantList, [], [], 0)
    await connection.send(request.encode(protocol))

    const [response] = await receiveMessages(receiver, protocol)
    await client.close()
    await service.stop()

    t.equal(response.blocks.length, 1)
    t.equal(response.blockPresences.length, 1)

    hasSingleDAGBlock(t, response, cid2Link)

    t.equal(getPresence(t, response, cid1).type, BlockPresence.Type.Have)
  }
)

t.test(`${protocol} - type=Mixed - cancel=true - no response received`, async t => {
  t.plan(1)

  const { client, service, connection, receiver } = await prepare(protocol)

  const wantList = new WantList(
    [
      new Entry(cid1, 1, true, Entry.WantType.Have, true),
      new Entry(cid2, 1, true, Entry.WantType.Block, true),
      new Entry(cid3, 1, true, Entry.WantType.Have, true),
      new Entry(cid4, 1, true, Entry.WantType.Block, true)
    ],
    false
  )

  const request = new Message(wantList, [], [], 0)
  await connection.send(request.encode(protocol))

  const responses = await receiveMessages(receiver, protocol)
  await client.close()
  await service.stop()

  t.equal(responses.length, 0)
})

t.test(`${protocol} - large blocks skipping`, async t => {
  t.plan(7)

  const { client, service, connection, receiver } = await prepare(protocol)

  const wantList = new WantList(
    [
      new Entry(cid5, 1, false, Entry.WantType.Block, true),
      new Entry(cid6, 1, false, Entry.WantType.Block, true),
      new Entry(cid7, 1, false, Entry.WantType.Block, true),
      new Entry(cid8, 1, false, Entry.WantType.Block, true)
    ],
    false
  )

  const request = new Message(wantList, [], [], 0)
  await connection.send(request.encode(protocol))
  await connection.send(request.encode(protocol))

  const responses = await receiveMessages(receiver, protocol, 30000, 2)
  await client.close()
  await service.stop()

  const blocks = [...responses[0].blocks, ...responses[1].blocks]

  t.equal(responses.length, 2)
  t.equal(responses[0].blocks.length, 2)
  t.equal(responses[1].blocks.length, 1)

  await hasSingleBlockWithHash(t, { blocks }, cid5.multihash)
  await hasSingleBlockWithHash(t, { blocks }, cid6.multihash)
  await hasSingleBlockWithHash(t, { blocks }, cid7.multihash)
  await hasSingleBlockWithHash(t, { blocks }, cid8.multihash, true)
})

t.test(`${protocol} - large messages skipping`, async t => {
  t.plan(5)

  const { client, service, connection, receiver } = await prepare(protocol)
  const numPresences = 1e3

  const wantList = new WantList(
    [
      new Entry(cid9, 1, false, Entry.WantType.Block, true),
      new Entry(cid9, 1, false, Entry.WantType.Block, true),
      ...Array.from(Array(numPresences), () => new Entry(cid1, 1, false, Entry.WantType.Have, false))
    ],
    false
  )

  const request = new Message(wantList, [], [], 0)
  await connection.send(request.encode(protocol))

  const responses = await receiveMessages(receiver, protocol, 30000, 2)
  await client.close()
  await service.stop()

  t.equal(responses.length, 2)

  t.equal(responses[0].blocks.length + responses[1].blocks.length, 2)
  t.ok(responses[0].blockPresences.length < numPresences)
  t.ok(responses[1].blockPresences.length < numPresences)
  t.equal(responses[0].blockPresences.length + responses[1].blockPresences.length, numPresences)
})
