import { Injectable } from '@angular/core';
import { Constants } from './constants';
import { Utils } from './utils';
import { Buffer } from 'buffer';
import { of, Subject } from 'rxjs';

const splitThreshold = 1800000000;

interface IEntryGroup {
  size: number;
  entries: any[];
  progress: number;
}

@Injectable({
  providedIn: 'root'
})
export class ZipService {

  constructor() { }

  private sortEntries(entryList: any[]) {
    return entryList.sort((a, b) => a.entryName.toLowerCase().localeCompare(b.entryName.toLowerCase()));
  }

  private makeZip(group: IEntryGroup, mainHeader: any, progress$: Subject<number>, file$: Subject<any>) {
    const entryList = group.entries;
    this.sortEntries(entryList);

    const dataBlock = [];
    const entryHeaders = [];
    let totalSize = 0;
    let dindex = 0;

    mainHeader.size = 0;
    mainHeader.offset = 0;

    let totalProgress = 0;
    let loopProgress = 0;

    for (let i = 0; i < entryList.length; i++) {
      // compress data and set local and entry header accordingly. Reason why is called first
      // const entryBuffer = entryList[i].entryBuffer;
      let entryBuffer = entryList[i].getEntryBuffer();
      entryList[i].clearEntryBuffer(); // clear buffer is essential else browser will get out of memory if many files are added;
      // 1. construct data header
      entryList[i].header.offset = dindex;
      let dataHeader = entryList[i].header.dataHeaderToBinary();
      const entryNameLen = entryList[i].rawEntryName.length;
      // 1.2. postheader - data after data header
      let postHeader: any = Buffer.alloc(entryNameLen + entryList[i].extra.length);
      entryList[i].rawEntryName.copy(postHeader, 0);
      postHeader.copy(entryList[i].extra, entryNameLen);

      // 2. offsets
      const dataLength = dataHeader.length + postHeader.length + entryBuffer.length;
      dindex += dataLength;

      // 3. store values in sequence
      dataBlock.push(dataHeader);
      dataBlock.push(postHeader);
      dataBlock.push(entryBuffer);

      // clear out memory
      dataHeader = null;
      postHeader = null;
      entryBuffer = null;

      // 4. construct entry header
      const entryHeader = entryList[i].packHeader();
      entryHeaders.push(entryHeader);
      // 5. update main header
      mainHeader.size += entryHeader.length;
      totalSize += dataLength + entryHeader.length;

      loopProgress = Math.round((((i + 1) / entryList.length) / 3) * 100);
      group.progress = totalProgress + loopProgress;
      progress$.next(group.progress);
    }

    totalProgress += loopProgress
    loopProgress = 0;
    totalSize += mainHeader.mainHeaderSize; // also includes zip file comment length
    // point to end of data and beginning of central directory first record
    mainHeader.offset = dindex;

    dindex = 0;
    let outBuffer: any = Buffer.alloc(totalSize);
    // write data blocks
    for (let i = 0; i < dataBlock.length; i++) {
      dataBlock[i].copy(outBuffer, dindex);
      dindex += dataBlock[i].length;

      loopProgress = Math.round((((i + 1) / dataBlock.length) / 3) * 100);
      group.progress = totalProgress + loopProgress;
      progress$.next(group.progress);
    }
    totalProgress += loopProgress
    loopProgress = 0;
    // write central directory entries
    for (let i = 0; i < entryHeaders.length; i++) {
      entryHeaders[i].copy(outBuffer, dindex);
      dindex += entryHeaders[i].length;

      loopProgress = Math.round((((i + 1) / entryHeaders.length) / 3) * 100);
      group.progress = totalProgress + loopProgress;
      progress$.next(group.progress);
    }

    // write main header
    const mh = mainHeader.toBinary();
    mh.copy(outBuffer, dindex);

    group.progress = 100;
    progress$.next(group.progress);
    file$.next(new Blob([outBuffer]));
    outBuffer = null;
  }

  newZipInstance() {
    const entryGroups: IEntryGroup[] = [];
    const entryList: any[] = [];
    const mainHeader = this.mainHeader();
    const self = this;
    const progress$: Subject<number> = new Subject();


    return {
      addFile: function (/**String*/ entryName: any, /**Buffer*/ buffer: any) {
        let entry = self.zipEntry();
        entry.entryName = entryName;

        // Set file attribute
        var fileattr = 0; // (MS-DOS directory flag)

        // extended attributes field for Unix
        if (!Utils.isWin) {
          // set file type S_IFREG
          let unix = 0x8000;
          unix |= 0o644; // permissions (-r-wr--r--)
          fileattr = (fileattr | (unix << 16)) >>> 0; // add attributes
        }
        entry.attr = fileattr;
        entry.setData(buffer);
        entryList.push(entry);
        const entryBufferLength = entry.getEntryBuffer().length;
        entry.clearEntryBuffer(); // clear buffer is essential else browser will get out of memory if many files are added;
        const groupToPushInto = entryGroups.find(group => group.size + entryBufferLength < splitThreshold);
        if (!!groupToPushInto) {
          groupToPushInto.size += entryBufferLength;
          groupToPushInto.entries.push(entry);
        } else {
          entryGroups.push({ size: entryBufferLength, entries: [entry], progress: 0 })
        }
        mainHeader.totalEntries = entryList.length;
      },
      getZipFile$(file$: Subject<any>, callback?: any) {
        if (!entryGroups.length) {
          file$.complete();
        }
        if (!!callback) {
          progress$.subscribe(() => {
            const combinedProgress = entryGroups.reduce((total, current) => total += current.progress, 0);
            callback(Math.round((combinedProgress / (entryGroups.length * 100)) * 100));
          });
        }
        for (let i = 0; i < entryGroups.length; i++) {
          self.makeZip(entryGroups[i], mainHeader, progress$, file$);
          entryGroups[i] = { size: 0, entries: [], progress: 0 };
        }
      },
    };
  };


  zipEntry() {
    let _entryHeader = this.entryHeader();
    let _entryName = Buffer.alloc(0);
    let _comment = Buffer.alloc(0);
    let _isDirectory = false;
    let uncompressedData: any = null;
    let entryBuffer: any = null;
    let _extra = Buffer.alloc(0);

    function readUInt64LE(buffer: any, offset: any) {
      return (buffer.readUInt32LE(offset + 4) << 4) + buffer.readUInt32LE(offset);
    }

    function parseExtra(data: any) {
      var offset = 0;
      var signature, size, part;
      while (offset < data.length) {
        signature = data.readUInt16LE(offset);
        offset += 2;
        size = data.readUInt16LE(offset);
        offset += 2;
        part = data.slice(offset, offset + size);
        offset += size;
        if (Constants.ID_ZIP64 === signature) {
          parseZip64ExtendedInformation(part);
        }
      }
    }

    //Override header field values with values from the ZIP64 extra field
    function parseZip64ExtendedInformation(data: any) {
      var size, compressedSize, offset, diskNumStart;

      if (data.length >= Constants.EF_ZIP64_SCOMP) {
        size = readUInt64LE(data, Constants.EF_ZIP64_SUNCOMP);
        if (_entryHeader.size === Constants.EF_ZIP64_OR_32) {
          _entryHeader.size = size;
        }
      }
      if (data.length >= Constants.EF_ZIP64_RHO) {
        compressedSize = readUInt64LE(data, Constants.EF_ZIP64_SCOMP);
        if (_entryHeader.compressedSize === Constants.EF_ZIP64_OR_32) {
          _entryHeader.compressedSize = compressedSize;
        }
      }
      if (data.length >= Constants.EF_ZIP64_DSN) {
        offset = readUInt64LE(data, Constants.EF_ZIP64_RHO);
        if (_entryHeader.offset === Constants.EF_ZIP64_OR_32) {
          _entryHeader.offset = offset;
        }
      }
      if (data.length >= Constants.EF_ZIP64_DSN + 4) {
        diskNumStart = data.readUInt32LE(Constants.EF_ZIP64_DSN);
        if (_entryHeader.diskNumStart === Constants.EF_ZIP64_OR_16) {
          _entryHeader.diskNumStart = diskNumStart;
        }
      }
    }

    return {
      get entryName() {
        return _entryName.toString();
      },
      get rawEntryName() {
        return _entryName;
      },
      set entryName(val) {
        _entryName = Utils.toBuffer(val);
        var lastChar = _entryName[_entryName.length - 1];
        _isDirectory = lastChar === 47 || lastChar === 92;
        _entryHeader.fileNameLength = _entryName.length;
      },

      get extra() {
        return _extra;
      },
      set extra(val) {
        _extra = val;
        _entryHeader.extraLength = val.length;
        parseExtra(val);
      },

      get comment() {
        return _comment.toString();
      },
      set comment(val) {
        _comment = Utils.toBuffer(val);
        _entryHeader.commentLength = _comment.length;
      },

      get name() {
        var n = _entryName.toString();
        return _isDirectory
          ? n
            .substr(n.length - 1)
            .split("/")
            .pop()
          : n.split("/").pop();
      },
      get isDirectory() {
        return _isDirectory;
      },

      getEntryBuffer: function () {
        entryBuffer = Buffer.alloc(uncompressedData.length);
        _entryHeader.compressedSize = _entryHeader.size;
        uncompressedData.copy(entryBuffer);
        return entryBuffer
      },

      clearEntryBuffer: function () {
        entryBuffer = null;
      },

      setData: function (value: any) {
        uncompressedData = Utils.toBuffer(value);
        _entryHeader.size = uncompressedData.length;
        _entryHeader.method = Constants.STORED;
        _entryHeader.crc = Utils.crc32(value);
        _entryHeader.changed = true;
      },

      getData: function (pass: any) {
        if (_entryHeader.changed) {
          return uncompressedData;
        }
      },

      getDataAsync: function (/*Function*/ callback: any, pass: any) {
        if (_entryHeader.changed) {
          callback(uncompressedData);
        }
      },

      set attr(attr) {
        _entryHeader.attr = attr;
      },
      get attr() {
        return _entryHeader.attr;
      },

      set header(/*Buffer*/ data) {
        _entryHeader.loadFromBinary(data);
      },

      get header() {
        return _entryHeader;
      },

      packHeader: function () {
        // 1. create header (buffer)
        var header = _entryHeader.entryHeaderToBinary();
        var addpos = Constants.CENHDR;
        // 2. add file name
        _entryName.copy(header, addpos);
        addpos += _entryName.length;
        // 3. add extra data
        if (_entryHeader.extraLength) {
          _extra.copy(header, addpos);
          addpos += _entryHeader.extraLength;
        }
        // 4. add file comment
        if (_entryHeader.commentLength) {
          _comment.copy(header, addpos);
        }
        return header;
      },
    };
  };


  mainHeader() {
    var _volumeEntries = 0,
      _totalEntries = 0,
      _size = 0,
      _offset = 0,
      _commentLength = 0;

    return {
      get diskEntries() {
        return _volumeEntries;
      },
      set diskEntries(/*Number*/ val) {
        _volumeEntries = _totalEntries = val;
      },

      get totalEntries() {
        return _totalEntries;
      },
      set totalEntries(/*Number*/ val) {
        _totalEntries = _volumeEntries = val;
      },

      get size() {
        return _size;
      },
      set size(/*Number*/ val) {
        _size = val;
      },

      get offset() {
        return _offset;
      },
      set offset(/*Number*/ val) {
        _offset = val;
      },

      get commentLength() {
        return _commentLength;
      },
      set commentLength(/*Number*/ val) {
        _commentLength = val;
      },

      get mainHeaderSize() {
        return Constants.ENDHDR + _commentLength;
      },

      toBinary: function () {
        var b = Buffer.alloc(Constants.ENDHDR + _commentLength);
        // "PK 05 06" signature
        b.writeUInt32LE(Constants.ENDSIG, 0);
        b.writeUInt32LE(0, 4);
        // number of entries on this volume
        b.writeUInt16LE(_volumeEntries, Constants.ENDSUB);
        // total number of entries
        b.writeUInt16LE(_totalEntries, Constants.ENDTOT);
        // central directory size in bytes
        b.writeUInt32LE(_size, Constants.ENDSIZ);
        // offset of first CEN header
        b.writeUInt32LE(_offset, Constants.ENDOFF);
        // zip file comment length
        b.writeUInt16LE(_commentLength, Constants.ENDCOM);
        // fill comment memory with spaces so no garbage is left there
        b.fill(" ", Constants.ENDHDR);

        return b;
      }
    };
  };

  entryHeader() {
    let _verMade = 20; // v2.0
    let _version = 10; // v1.0
    let _flags = 0;
    let _method = 0;
    let _time = 0;
    let _crc = 0;
    let _compressedSize = 0;
    let _size = 0;
    let _fnameLen = 0;
    let _extraLen = 0;
    let _comLen = 0;
    let _diskStart = 0;
    let _inattr = 0;
    let _attr = 0;
    let _offset = 0;
    let _changed = false;

    _verMade |= Utils.isWin ? 0x0a00 : 0x0300;

    // Set EFS flag since filename and comment fields are all by default encoded using UTF-8.
    // Without it file names may be corrupted for other apps when file names use unicode chars
    _flags |= Constants.FLG_EFS;

    let _dataHeader: any = {};

    function setTime(val: any) {
      val = new Date(val);
      _time =
        (((val.getFullYear() - 1980) & 0x7f) << 25) | // b09-16 years from 1980
        ((val.getMonth() + 1) << 21) | // b05-08 month
        (val.getDate() << 16) | // b00-04 hour
        // 2 bytes time
        (val.getHours() << 11) | // b11-15 hour
        (val.getMinutes() << 5) | // b05-10 minute
        (val.getSeconds() >> 1); // b00-04 seconds divided by 2
    }

    setTime(+new Date());

    return {
      get made() {
        return _verMade;
      },
      set made(val) {
        _verMade = val;
      },

      get version() {
        return _version;
      },
      set version(val) {
        _version = val;
      },

      get flags() {
        return _flags;
      },
      set flags(val) {
        _flags = val;
      },

      get method() {
        return _method;
      },
      set method(val) {
        this.version = 10;
        _method = val;
      },

      get time() {
        return new Date(((_time >> 25) & 0x7f) + 1980, ((_time >> 21) & 0x0f) - 1, (_time >> 16) & 0x1f, (_time >> 11) & 0x1f, (_time >> 5) & 0x3f, (_time & 0x1f) << 1);
      },
      set time(val) {
        setTime(val);
      },

      get crc() {
        return _crc;
      },
      set crc(val) {
        _crc = Math.max(0, val) >>> 0;
      },

      get compressedSize() {
        return _compressedSize;
      },
      set compressedSize(val) {
        _compressedSize = Math.max(0, val) >>> 0;
      },

      get size() {
        return _size;
      },
      set size(val) {
        _size = Math.max(0, val) >>> 0;
      },

      get fileNameLength() {
        return _fnameLen;
      },
      set fileNameLength(val) {
        _fnameLen = val;
      },

      get extraLength() {
        return _extraLen;
      },
      set extraLength(val) {
        _extraLen = val;
      },

      get commentLength() {
        return _comLen;
      },
      set commentLength(val) {
        _comLen = val;
      },

      get diskNumStart() {
        return _diskStart;
      },
      set diskNumStart(val) {
        _diskStart = Math.max(0, val) >>> 0;
      },

      get inAttr() {
        return _inattr;
      },
      set inAttr(val) {
        _inattr = Math.max(0, val) >>> 0;
      },

      get attr() {
        return _attr;
      },
      set attr(val) {
        _attr = Math.max(0, val) >>> 0;
      },

      // get Unix file permissions
      get fileAttr() {
        return _attr ? (((_attr >>> 0) | 0) >> 16) & 0xfff : 0;
      },

      get offset() {
        return _offset;
      },
      set offset(val) {
        _offset = Math.max(0, val) >>> 0;
      },

      get changed() {
        return _changed;
      },
      set changed(val) {
        _changed = val;
      },

      get encripted() {
        return (_flags & 1) === 1;
      },

      get entryHeaderSize() {
        return Constants.CENHDR + _fnameLen + _extraLen + _comLen;
      },

      get realDataOffset() {
        return _offset + Constants.LOCHDR + _dataHeader.fnameLen + _dataHeader.extraLen;
      },

      get dataHeader() {
        return _dataHeader;
      },

      loadFromBinary: function (/*Buffer*/ data: any) {
        // data should be 46 bytes and start with "PK 01 02"
        if (data.length !== Constants.CENHDR || data.readUInt32LE(0) !== Constants.CENSIG) {
          throw new Error(Utils.Errors.INVALID_CEN);
        }
        // version made by
        _verMade = data.readUInt16LE(Constants.CENVEM);
        // version needed to extract
        _version = data.readUInt16LE(Constants.CENVER);
        // encrypt, decrypt flags
        _flags = data.readUInt16LE(Constants.CENFLG);
        // compression method
        _method = data.readUInt16LE(Constants.CENHOW);
        // modification time (2 bytes time, 2 bytes date)
        _time = data.readUInt32LE(Constants.CENTIM);
        // uncompressed file crc-32 value
        _crc = data.readUInt32LE(Constants.CENCRC);
        // compressed size
        _compressedSize = data.readUInt32LE(Constants.CENSIZ);
        // uncompressed size
        _size = data.readUInt32LE(Constants.CENLEN);
        // filename length
        _fnameLen = data.readUInt16LE(Constants.CENNAM);
        // extra field length
        _extraLen = data.readUInt16LE(Constants.CENEXT);
        // file comment length
        _comLen = data.readUInt16LE(Constants.CENCOM);
        // volume number start
        _diskStart = data.readUInt16LE(Constants.CENDSK);
        // internal file attributes
        _inattr = data.readUInt16LE(Constants.CENATT);
        // external file attributes
        _attr = data.readUInt32LE(Constants.CENATX);
        // LOC header offset
        _offset = data.readUInt32LE(Constants.CENOFF);
      },

      dataHeaderToBinary: function () {
        // LOC header size (30 bytes)
        var data = Buffer.alloc(Constants.LOCHDR);
        // "PK\003\004"
        data.writeUInt32LE(Constants.LOCSIG, 0);
        // version needed to extract
        data.writeUInt16LE(_version, Constants.LOCVER);
        // general purpose bit flag
        data.writeUInt16LE(_flags, Constants.LOCFLG);
        // compression method
        data.writeUInt16LE(_method, Constants.LOCHOW);
        // modification time (2 bytes time, 2 bytes date)
        data.writeUInt32LE(_time, Constants.LOCTIM);
        // uncompressed file crc-32 value
        data.writeUInt32LE(_crc, Constants.LOCCRC);
        // compressed size
        data.writeUInt32LE(_compressedSize, Constants.LOCSIZ);
        // uncompressed size
        data.writeUInt32LE(_size, Constants.LOCLEN);
        // filename length
        data.writeUInt16LE(_fnameLen, Constants.LOCNAM);
        // extra field length
        data.writeUInt16LE(_extraLen, Constants.LOCEXT);
        return data;
      },

      entryHeaderToBinary: function () {
        // CEN header size (46 bytes)
        var data = Buffer.alloc(Constants.CENHDR + _fnameLen + _extraLen + _comLen);
        // "PK\001\002"
        data.writeUInt32LE(Constants.CENSIG, 0);
        // version made by
        data.writeUInt16LE(_verMade, Constants.CENVEM);
        // version needed to extract
        data.writeUInt16LE(_version, Constants.CENVER);
        // encrypt, decrypt flags
        data.writeUInt16LE(_flags, Constants.CENFLG);
        // compression method
        data.writeUInt16LE(_method, Constants.CENHOW);
        // modification time (2 bytes time, 2 bytes date)
        data.writeUInt32LE(_time, Constants.CENTIM);
        // uncompressed file crc-32 value
        data.writeUInt32LE(_crc, Constants.CENCRC);
        // compressed size
        data.writeUInt32LE(_compressedSize, Constants.CENSIZ);
        // uncompressed size
        data.writeUInt32LE(_size, Constants.CENLEN);
        // filename length
        data.writeUInt16LE(_fnameLen, Constants.CENNAM);
        // extra field length
        data.writeUInt16LE(_extraLen, Constants.CENEXT);
        // file comment length
        data.writeUInt16LE(_comLen, Constants.CENCOM);
        // volume number start
        data.writeUInt16LE(_diskStart, Constants.CENDSK);
        // internal file attributes
        data.writeUInt16LE(_inattr, Constants.CENATT);
        // external file attributes
        data.writeUInt32LE(_attr, Constants.CENATX);
        // LOC header offset
        data.writeUInt32LE(_offset, Constants.CENOFF);
        // fill all with
        data.fill(0x00, Constants.CENHDR);
        return data;
      },

      toJSON: function () {
        const bytes = function (nr: any) {
          return nr + " bytes";
        };

        return {
          made: _verMade,
          version: _version,
          flags: _flags,
          method: Utils.methodToString(_method),
          time: this.time,
          crc: "0x" + _crc.toString(16).toUpperCase(),
          compressedSize: bytes(_compressedSize),
          size: bytes(_size),
          fileNameLength: bytes(_fnameLen),
          extraLength: bytes(_extraLen),
          commentLength: bytes(_comLen),
          diskNumStart: _diskStart,
          inAttr: _inattr,
          attr: _attr,
          offset: _offset,
          entryHeaderSize: bytes(Constants.CENHDR + _fnameLen + _extraLen + _comLen)
        };
      },

      toString: function () {
        return JSON.stringify(this.toJSON(), null, "\t");
      }
    };
  };



}
