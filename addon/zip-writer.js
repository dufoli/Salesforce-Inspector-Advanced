/* global */

/**
 * Minimal ZIP archive writer (store method, no compression).
 * Used to build small Salesforce Metadata API deployable packages entirely in the
 * browser (e.g. from addon/packages/), without depending on any third-party library.
 */

const CRC_TABLE = buildCrcTable();

function buildCrcTable() {
  let table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  let dosTime = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1F);
  let dosDate = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
  return {dosTime, dosDate};
}

/**
 * Builds an uncompressed (store method) ZIP archive from a list of text files.
 * @param {Array<{name: string, content: string}>} files - name is the path inside the zip (e.g. "package.xml" or "genAiPromptTemplates/Foo.genAiPromptTemplate-meta.xml")
 * @returns {Uint8Array} the raw bytes of the ZIP file
 */
export function createZip(files) {
  const encoder = new TextEncoder();
  const {dosTime, dosDate} = dosDateTime(new Date());
  let localParts = [];
  let centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);

    let localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true); // local file header signature
    localHeader.setUint16(4, 20, true); // version needed to extract
    localHeader.setUint16(6, 0, true); // general purpose bit flag
    localHeader.setUint16(8, 0, true); // compression method: stored
    localHeader.setUint16(10, dosTime, true);
    localHeader.setUint16(12, dosDate, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, dataBytes.length, true); // compressed size
    localHeader.setUint32(22, dataBytes.length, true); // uncompressed size
    localHeader.setUint16(26, nameBytes.length, true);
    localHeader.setUint16(28, 0, true); // extra field length
    const localHeaderBytes = new Uint8Array(localHeader.buffer);

    localParts.push(localHeaderBytes, nameBytes, dataBytes);

    let centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true); // central directory file header signature
    centralHeader.setUint16(4, 20, true); // version made by
    centralHeader.setUint16(6, 20, true); // version needed to extract
    centralHeader.setUint16(8, 0, true); // general purpose bit flag
    centralHeader.setUint16(10, 0, true); // compression method: stored
    centralHeader.setUint16(12, dosTime, true);
    centralHeader.setUint16(14, dosDate, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, dataBytes.length, true); // compressed size
    centralHeader.setUint32(24, dataBytes.length, true); // uncompressed size
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint16(30, 0, true); // extra field length
    centralHeader.setUint16(32, 0, true); // file comment length
    centralHeader.setUint16(34, 0, true); // disk number start
    centralHeader.setUint16(36, 0, true); // internal file attributes
    centralHeader.setUint32(38, 0, true); // external file attributes
    centralHeader.setUint32(42, offset, true); // relative offset of local header

    centralParts.push(new Uint8Array(centralHeader.buffer), nameBytes);

    offset += localHeaderBytes.length + nameBytes.length + dataBytes.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralParts.reduce((sum, part) => sum + part.length, 0);

  let endRecord = new DataView(new ArrayBuffer(22));
  endRecord.setUint32(0, 0x06054b50, true); // end of central directory signature
  endRecord.setUint16(4, 0, true); // disk number
  endRecord.setUint16(6, 0, true); // disk with the start of the central directory
  endRecord.setUint16(8, files.length, true); // entries on this disk
  endRecord.setUint16(10, files.length, true); // total entries
  endRecord.setUint32(12, centralDirSize, true);
  endRecord.setUint32(16, centralDirOffset, true);
  endRecord.setUint16(20, 0, true); // comment length

  const allParts = [...localParts, ...centralParts, new Uint8Array(endRecord.buffer)];
  const totalLength = allParts.reduce((sum, part) => sum + part.length, 0);
  let result = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of allParts) {
    result.set(part, pos);
    pos += part.length;
  }
  return result;
}

/**
 * Base64-encodes raw bytes, for handing a ZIP archive built with createZip to the Metadata API's deploy(ZipFile) call.
 */
export function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
