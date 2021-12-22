'use strict'

const { base58btc: base58 } = require('multiformats/bases/base58')
const { CID } = require('multiformats/cid')
const { decode: digestDecode } = require('multiformats/hashes/digest')

const digest = digestDecode(base58.decode(process.argv[2]))
const codec = parseInt(process.argv[3])
console.log(`Multihash HEX digest: ${Buffer.from(digest.digest).toString('hex')}`)
console.log(`CID (v1): ${CID.create(1, codec, digest).toString()}`)
