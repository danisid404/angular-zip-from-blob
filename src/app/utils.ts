import {Constants} from './constants'
import {Buffer} from 'buffer'
const isWin = navigator.userAgent.toLowerCase().includes('windows');

// generate CRC32 lookup table
const crcTable = new Uint32Array(256).map((t, c) => {
    for (let k = 0; k < 8; k++) {
        if ((c & 1) !== 0) {
            c = 0xedb88320 ^ (c >>> 1);
        } else {
            c >>>= 1;
        }
    }
    return c >>> 0;
});

// UTILS functions

function Utilss() {}

export const Utils = Utilss;

// crc32 single update (it is part of crc32)
Utilss.crc32update = function (crc: any, byte: any) {
    return crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
};

Utilss.crc32 = function (buf: any) {
    if (typeof buf === "string") {
        buf = Buffer.from(buf, "utf8");
    }
    // Generate crcTable
    // if (!crcTable.length) genCRCTable();

    let len = buf.length;
    let crc = ~0;
    for (let off = 0; off < len; ) crc = Utilss.crc32update(crc, buf[off++]);
    // xor and cast as uint32 number
    return ~crc >>> 0;
};
// converts buffer, Uint8Array, string types to buffer
Utilss.toBuffer = function toBuffer(/*buffer, Uint8Array, string*/ input: any) {
    if (Buffer.isBuffer(input)) {
        return input;
    } else if (input instanceof Uint8Array) {
        return Buffer.from(input);
    } else {
        // expect string all other values are invalid and return empty buffer
        return typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.alloc(0);
    }
};

Utilss.methodToString = function (/*Number*/ method: any) {
    switch (method) {
        case Constants.STORED:
            return "STORED (" + method + ")";
        case Constants.DEFLATED:
            return "DEFLATED (" + method + ")";
        default:
            return "UNSUPPORTED (" + method + ")";
    }
};

Utilss.readBigUInt64LE = function (/*Buffer*/ buffer: any, /*int*/ index: any) {
    var slice = Buffer.from(buffer.slice(index, index + 8));
    slice.swap64();

    return parseInt(`0x${slice.toString("hex")}`);
};

Utilss.isWin = isWin; // Do we have windows system
Utilss.crcTable = crcTable;

Utilss.Errors = {
    /* Header error messages */
    INVALID_LOC: "Invalid LOC header (bad signature)",
    INVALID_CEN: "Invalid CEN header (bad signature)",
    INVALID_END: "Invalid END header (bad signature)",

    /* ZipEntry error messages*/
    NO_DATA: "Nothing to decompress",
    BAD_CRC: "CRC32 checksum failed",
    FILE_IN_THE_WAY: "There is a file in the way: %s",
    UNKNOWN_METHOD: "Invalid/unsupported compression method",

    /* Inflater error messages */
    AVAIL_DATA: "inflate::Available inflate data did not terminate",
    INVALID_DISTANCE: "inflate::Invalid literal/length or distance code in fixed or dynamic block",
    TO_MANY_CODES: "inflate::Dynamic block code description: too many length or distance codes",
    INVALID_REPEAT_LEN: "inflate::Dynamic block code description: repeat more than specified lengths",
    INVALID_REPEAT_FIRST: "inflate::Dynamic block code description: repeat lengths with no first length",
    INCOMPLETE_CODES: "inflate::Dynamic block code description: code lengths codes incomplete",
    INVALID_DYN_DISTANCE: "inflate::Dynamic block code description: invalid distance code lengths",
    INVALID_CODES_LEN: "inflate::Dynamic block code description: invalid literal/length code lengths",
    INVALID_STORE_BLOCK: "inflate::Stored block length did not match one's complement",
    INVALID_BLOCK_TYPE: "inflate::Invalid block type (type == 3)",

    /* ADM-ZIP error messages */
    CANT_EXTRACT_FILE: "Could not extract the file",
    CANT_OVERRIDE: "Target file already exists",
    NO_ZIP: "No zip file was loaded",
    NO_ENTRY: "Entry doesn't exist",
    DIRECTORY_CONTENT_ERROR: "A directory cannot have content",
    FILE_NOT_FOUND: "File not found: %s",
    NOT_IMPLEMENTED: "Not implemented",
    INVALID_FILENAME: "Invalid filename",
    INVALID_FORMAT: "Invalid or unsupported zip format. No END header found"
}
