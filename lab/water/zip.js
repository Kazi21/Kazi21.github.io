/* Minimal ZIP writer for the Live Water Lab export (no libraries). Files are deflated with the browser's
   CompressionStream when available, otherwise stored uncompressed; both are standard ZIP entries. */
(function (root) {
  'use strict';
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const out = new Response(new Blob([bytes]).stream().pipeThrough(cs));
      return new Uint8Array(await out.arrayBuffer());
    } catch (e) { return null; }
  }
  function dosTime(d) {
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
             date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  /* files: { name: string | Uint8Array } -> Promise<Blob> */
  async function makeZip(files, when) {
    const enc = new TextEncoder();
    const t = dosTime(when || new Date());
    const parts = [], central = [];
    let offset = 0;
    for (const name of Object.keys(files)) {
      const raw = typeof files[name] === 'string' ? enc.encode(files[name]) : files[name];
      const crc = crc32(raw);
      const def = raw.length > 256 ? await deflateRaw(raw) : null;
      const useDef = def && def.length < raw.length;
      const data = useDef ? def : raw;
      const nb = enc.encode(name);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, useDef ? 8 : 0, true); lh.setUint16(10, t.time, true); lh.setUint16(12, t.date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true);
      lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nb, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, useDef ? 8 : 0, true); ch.setUint16(12, t.time, true); ch.setUint16(14, t.date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true);
      ch.setUint16(28, nb.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nb);
      offset += 30 + nb.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    const n = Object.keys(files).length;
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, n, true); end.setUint16(10, n, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }
  const api = { makeZip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WaterZip = api;
})(typeof self !== 'undefined' ? self : this);
