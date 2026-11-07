// Minimal DNS wire-format handling for the OOB server (#85). No dependency — a query parser (we only
// need the QNAME + QTYPE to log the callback) and an A-record response builder (so the target's resolver
// gets an answer and an HTTP follow-up connects to us). Not a general resolver; just enough to capture.
export namespace OobDns {
  export interface Query {
    id: number
    qname: string
    qtype: number
    questionEnd: number // byte offset where the question section ends (for building the response)
  }

  // Parse a DNS query: header (12B) + the first question (QNAME labels, QTYPE, QCLASS). Returns undefined
  // on a malformed/empty packet so the server just drops it.
  export function parseQuery(buf: Buffer): Query | undefined {
    if (buf.length < 12) return undefined
    const id = buf.readUInt16BE(0)
    if (buf.readUInt16BE(4) < 1) return undefined // qdcount
    let off = 12
    const labels: string[] = []
    while (off < buf.length) {
      const len = buf[off]!
      if (len === 0) {
        off++
        break
      }
      if ((len & 0xc0) === 0xc0) {
        off += 2 // a compression pointer — unusual in a query; stop the name here
        break
      }
      off++
      if (off + len > buf.length) return undefined
      labels.push(buf.subarray(off, off + len).toString("ascii"))
      off += len
    }
    if (off + 4 > buf.length) return undefined
    const qtype = buf.readUInt16BE(off)
    return { id, qname: labels.join("."), qtype, questionEnd: off + 4 }
  }

  // Build a response to `query` that answers an A query with `answerIP` (echoes the question; A-record via
  // a name-compression pointer to the question). For non-A queries, a NOERROR response with no answer.
  export function buildResponse(query: Buffer, q: Query, answerIP: string): Buffer {
    const header = Buffer.alloc(12)
    query.copy(header, 0, 0, 12)
    header.writeUInt16BE(0x8180, 2) // QR=1, RD copied, RA=1, rcode=0
    header.writeUInt16BE(1, 4) // qdcount
    const isA = q.qtype === 1
    header.writeUInt16BE(isA ? 1 : 0, 6) // ancount
    header.writeUInt16BE(0, 8) // nscount
    header.writeUInt16BE(0, 10) // arcount
    const question = query.subarray(12, q.questionEnd)
    if (!isA) return Buffer.concat([header, question])
    const octets = answerIP.split(".").map((n) => parseInt(n, 10) & 0xff)
    const answer = Buffer.alloc(16)
    answer.writeUInt16BE(0xc00c, 0) // NAME: pointer to the question name at offset 12
    answer.writeUInt16BE(1, 2) // TYPE A
    answer.writeUInt16BE(1, 4) // CLASS IN
    answer.writeUInt32BE(60, 6) // TTL
    answer.writeUInt16BE(4, 10) // RDLENGTH
    answer[12] = octets[0] ?? 0
    answer[13] = octets[1] ?? 0
    answer[14] = octets[2] ?? 0
    answer[15] = octets[3] ?? 0
    return Buffer.concat([header, question, answer])
  }

  // Encode a QNAME (for tests / building a query). `example.com` → length-prefixed labels + 0x00.
  export function encodeName(name: string): Buffer {
    const parts = name.split(".").filter(Boolean)
    const bufs = parts.map((p) => Buffer.concat([Buffer.from([p.length]), Buffer.from(p, "ascii")]))
    return Buffer.concat([...bufs, Buffer.from([0])])
  }
}
