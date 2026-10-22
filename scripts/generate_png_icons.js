import fs from 'node:fs';
import zlib from 'node:zlib';

/**
 * Generates an uncompressed/deflated valid PNG image buffer of width x height
 * with emergency red background (#b71c1c) and an inner white shield/shelter graphic.
 */
function createPng(width, height) {
    // RGBA buffer: 4 bytes per pixel + 1 filter byte per scanline
    const stride = width * 4 + 1;
    const rawData = Buffer.alloc(height * stride);

    const red = 0xb7, green = 0x1c, blue = 0x1c, alpha = 0xff;
    const white = 0xff;

    const cx = width / 2;
    const cy = height / 2;
    const radius = width * 0.44;

    for (let y = 0; y < height; y++) {
        const rowOffset = y * stride;
        rawData[rowOffset] = 0; // Filter type 0 (None)

        for (let x = 0; x < width; x++) {
            const pixelOffset = rowOffset + 1 + x * 4;
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.hypot(dx, dy);

            // Circular shield icon
            if (dist <= radius) {
                // Inner shelter shape: roof and house
                const inRoof = (y >= cy - radius * 0.45 && y <= cy && Math.abs(dx) <= (cy - y + 15) * 1.2);
                const inBuilding = (y > cy && y <= cy + radius * 0.55 && Math.abs(dx) <= radius * 0.5);
                const inDoor = (y > cy + radius * 0.15 && y <= cy + radius * 0.55 && Math.abs(dx) <= radius * 0.16);

                if ((inRoof || inBuilding) && !inDoor) {
                    rawData[pixelOffset] = white;
                    rawData[pixelOffset + 1] = white;
                    rawData[pixelOffset + 2] = white;
                    rawData[pixelOffset + 3] = alpha;
                } else {
                    rawData[pixelOffset] = red;
                    rawData[pixelOffset + 1] = green;
                    rawData[pixelOffset + 2] = blue;
                    rawData[pixelOffset + 3] = alpha;
                }
            } else {
                // Rounded corner border or dark background
                rawData[pixelOffset] = 0x12;
                rawData[pixelOffset + 1] = 0x18;
                rawData[pixelOffset + 2] = 0x20;
                rawData[pixelOffset + 3] = alpha;
            }
        }
    }

    const compressed = zlib.deflateSync(rawData);

    // PNG Signature
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // bit depth
    ihdrData[9] = 6; // color type (RGBA)
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace
    const ihdrChunk = createChunk('IHDR', ihdrData);

    // IDAT chunk
    const idatChunk = createChunk('IDAT', compressed);

    // IEND chunk
    const iendChunk = createChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);

    const crcBuf = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = crc32(crcBuf);
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
}

// CRC32 implementation
function crc32(buf) {
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ (-1)) >>> 0;
}

const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table[i] = c;
}

// Write out the PNGs
fs.writeFileSync('icons/icon-192.png', createPng(192, 192));
fs.writeFileSync('icons/icon-512.png', createPng(512, 512));
console.log('Successfully generated icons/icon-192.png and icons/icon-512.png');
