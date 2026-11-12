/**
 * A ZIP writer with no compression, so "Download all (ZIP)" can be built in the browser without a library: resumes
 * are PDFs and Word files, already compressed, and a store-only ZIP is just headers plus the bytes. Pure (no DOM), so
 * the tests run it in Node. The classic format allows 65,535 entries and 4 GB per archive; the caller starts a new
 * part before ZIP_MAX_ENTRIES / ZIP_MAX_BYTES.
 */

export const ZIP_MAX_ENTRIES = 65_000;
export const ZIP_MAX_BYTES = 3.5 * 1024 * 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time fields (local time; the format has no zone). Years outside 1980-2107 are clamped. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const UTF8_FLAG = 0x0800;

export class ZipWriter {
  private offset = 0;
  private count = 0;
  private readonly central: Uint8Array[] = [];

  /** `sink` receives the archive's bytes in order (write them to a file or collect them). */
  constructor(private readonly sink: (chunk: Uint8Array) => void | Promise<void>) {}

  get entries(): number {
    return this.count;
  }

  /** Bytes written so far (the archive's size once finish() has run). */
  get bytes(): number {
    return this.offset;
  }

  async add(name: string, data: Uint8Array, modified: Date): Promise<void> {
    if (this.count >= 65_535) throw new Error("ZIP is full (65,535 entries)");
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const { time, date } = dosDateTime(modified);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, 0, true); // method: store
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    const entry = new DataView(new ArrayBuffer(46 + nameBytes.length));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true); // version made by
    entry.setUint16(6, 20, true); // version needed
    entry.setUint16(8, UTF8_FLAG, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint16(30, 0, true); // extra
    entry.setUint16(32, 0, true); // comment
    entry.setUint16(34, 0, true); // disk
    entry.setUint16(36, 0, true); // internal attributes
    entry.setUint32(38, 0, true); // external attributes
    entry.setUint32(42, this.offset, true); // local header offset
    new Uint8Array(entry.buffer, 46).set(nameBytes);
    this.central.push(new Uint8Array(entry.buffer));

    await this.sink(new Uint8Array(local.buffer));
    await this.sink(nameBytes);
    await this.sink(data);
    this.offset += 30 + nameBytes.length + data.length;
    this.count += 1;
  }

  /** Writes the central directory and the end record. Call once; the writer is finished afterwards. */
  async finish(): Promise<void> {
    const start = this.offset;
    let size = 0;
    for (const entry of this.central) {
      await this.sink(entry);
      size += entry.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, this.count, true);
    end.setUint16(10, this.count, true);
    end.setUint32(12, size, true);
    end.setUint32(16, start, true);
    end.setUint16(20, 0, true);
    await this.sink(new Uint8Array(end.buffer));
    this.offset = start + size + 22;
  }
}

/** A name not used in the archive yet: "x.pdf", then "x (2).pdf", "x (3).pdf"; also drops path separators. */
export function uniqueZipName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/]+/g, "_").trim() || "file";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${stem} (${n})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
