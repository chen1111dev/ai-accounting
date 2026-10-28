/**
 * xlsx.js — Excel 工作簿（.xlsx / .xlsm）最小解析器（纯函数，零依赖，UMD）
 *
 * 只实现账单导入需要的 Open XML 子集：ZIP 目录、sharedStrings、worksheet，
 * 最终把首个工作表转换为 CSV 文本，再交给 analysis.js 的既有流水线处理。
 * 模块不访问 DOM / 文件系统 / 存储；DEFLATE 解压函数由调用方注入。
 *
 * 浏览器：挂载 window.AJ.xlsx
 * Node  ：require('./xlsx.js') 返回 API，可注入 zlib.inflateRawSync 做单测
 */
(function (global) {
  'use strict';

  var SIG_LOCAL = 0x04034b50;
  var SIG_CENTRAL = 0x02014b50;
  var SIG_EOCD = 0x06054b50;
  var MAX_EOCD_SCAN = 65535 + 22;
  var MAX_ENTRY_SIZE = 64 * 1024 * 1024;
  var MAX_TOTAL_SIZE = 128 * 1024 * 1024;

  /** 把常见二进制输入统一为 Uint8Array；非法输入返回 null。 */
  function toBytes(input) {
    try {
      if (!input) { return null; }
      if (typeof Uint8Array !== 'undefined' && input instanceof Uint8Array) {
        return input;
      }
      if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
        return new Uint8Array(input);
      }
      if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength || 0);
      }
      if (Array.isArray(input)) { return new Uint8Array(input); }
    } catch (e) {
      return null;
    }
    return null;
  }

  /** 安全读取 ZIP 小端整数；越界返回 -1。 */
  function readU16(bytes, offset) {
    if (!bytes || offset < 0 || offset + 2 > bytes.length) { return -1; }
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readU32(bytes, offset) {
    if (!bytes || offset < 0 || offset + 4 > bytes.length) { return -1; }
    return (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>> 0;
  }

  /** UTF-8 解码；优先 TextDecoder，缺失时使用内置严格边界解码器。 */
  function decodeUtf8(input) {
    var bytes = toBytes(input);
    if (!bytes) { return ''; }
    try {
      if (typeof TextDecoder === 'function') {
        return new TextDecoder('utf-8').decode(bytes);
      }
    } catch (e) {
      /* 继续走内置解码。 */
    }
    var out = '';
    var i = 0;
    while (i < bytes.length) {
      var b0 = bytes[i++];
      var cp;
      var b1;
      var b2;
      var b3;
      if (b0 < 0x80) {
        cp = b0;
      } else if (b0 >= 0xc2 && b0 <= 0xdf && i < bytes.length) {
        b1 = bytes[i++];
        cp = (b1 & 0xc0) === 0x80 ? ((b0 & 0x1f) << 6) | (b1 & 0x3f) : 0xfffd;
      } else if (b0 >= 0xe0 && b0 <= 0xef && i + 1 < bytes.length) {
        b1 = bytes[i++];
        b2 = bytes[i++];
        if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 ||
            (b0 === 0xe0 && b1 < 0xa0) || (b0 === 0xed && b1 >= 0xa0)) {
          cp = 0xfffd;
        } else {
          cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
        }
      } else if (b0 >= 0xf0 && b0 <= 0xf4 && i + 2 < bytes.length) {
        b1 = bytes[i++];
        b2 = bytes[i++];
        b3 = bytes[i++];
        if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80 ||
            (b0 === 0xf0 && b1 < 0x90) || (b0 === 0xf4 && b1 >= 0x90)) {
          cp = 0xfffd;
        } else {
          cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) |
            ((b2 & 0x3f) << 6) | (b3 & 0x3f);
        }
      } else {
        cp = 0xfffd;
      }
      if (cp <= 0xffff) {
        out += String.fromCharCode(cp);
      } else {
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return out;
  }

  /** 给数组附加不参与枚举/深比较的解析元信息。 */
  function setListMeta(list, key, value) {
    try {
      Object.defineProperty(list, key, { value: value, writable: true, configurable: true });
    } catch (e) {
      list[key] = value;
    }
  }

  /**
   * 判断输入是否为现代 Excel 工作簿：文件名后缀优先，其次 ZIP 魔数。
   * 支持 isXlsx(bytes, name) / isXlsx({name, bytes}) / isXlsx(name) 三种调用。
   */
  function isXlsx(input, name) {
    var bytes = input;
    var fileName = typeof name === 'string' ? name : '';
    try {
      if (typeof input === 'string' && !fileName) {
        fileName = input;
        bytes = null;
      } else if (input && typeof input === 'object' && !toBytes(input) &&
                 (Object.prototype.hasOwnProperty.call(input, 'name') ||
                  Object.prototype.hasOwnProperty.call(input, 'bytes'))) {
        fileName = typeof input.name === 'string' ? input.name : fileName;
        bytes = input.bytes || input.data || null;
      }
      if (/\.(xlsx|xlsm)$/i.test(String(fileName || '').trim())) { return true; }
      var b = toBytes(bytes);
      return !!(b && b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b &&
        b[2] === 0x03 && b[3] === 0x04);
    } catch (e) {
      return false;
    }
  }

  /**
   * 读取 ZIP Central Directory，返回条目数组。
   * 条目 offset 已按对应 local header 的 fileNameLen / extraLen 计算为压缩数据起点。
   * 无法解析时返回空数组，原因保存在非枚举属性 entries.reason；ZIP64 标记 entries.zip64。
   */
  function listEntries(input) {
    var bytes = toBytes(input);
    var entries = [];
    setListMeta(entries, 'reason', '');
    setListMeta(entries, 'zip64', false);
    if (!bytes || bytes.length < 22) {
      entries.reason = 'ZIP 数据为空或已截断';
      return entries;
    }

    var minOffset = Math.max(0, bytes.length - MAX_EOCD_SCAN);
    var eocd = -1;
    var p;
    for (p = bytes.length - 22; p >= minOffset; p--) {
      if (readU32(bytes, p) === SIG_EOCD) {
        var commentLen = readU16(bytes, p + 20);
        if (commentLen >= 0 && p + 22 + commentLen <= bytes.length) {
          eocd = p;
          break;
        }
      }
    }
    if (eocd < 0) {
      entries.reason = '找不到 ZIP 中央目录（文件可能已截断）';
      return entries;
    }

    var diskNo = readU16(bytes, eocd + 4);
    var centralDisk = readU16(bytes, eocd + 6);
    var diskCount = readU16(bytes, eocd + 8);
    var totalCount = readU16(bytes, eocd + 10);
    var centralSize = readU32(bytes, eocd + 12);
    var centralOffset = readU32(bytes, eocd + 16);
    if (diskNo !== 0 || centralDisk !== 0 || diskCount !== totalCount) {
      entries.reason = '不支持分卷 ZIP 工作簿';
      return entries;
    }
    if (totalCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      entries.zip64 = true;
      entries.reason = '暂不支持 ZIP64 格式的超大 Excel 文件';
      return entries;
    }
    if (centralOffset < 0 || centralOffset + centralSize > bytes.length || centralOffset > eocd) {
      entries.reason = 'ZIP 中央目录位置无效（文件可能已损坏）';
      return entries;
    }

    p = centralOffset;
    var index;
    for (index = 0; index < totalCount; index++) {
      if (p + 46 > bytes.length || readU32(bytes, p) !== SIG_CENTRAL) {
        entries.length = 0;
        entries.reason = 'ZIP 中央目录条目无效（文件可能已损坏）';
        return entries;
      }
      var flags = readU16(bytes, p + 8);
      var method = readU16(bytes, p + 10);
      var compSize = readU32(bytes, p + 20);
      var origSize = readU32(bytes, p + 24);
      var nameLen = readU16(bytes, p + 28);
      var extraLen = readU16(bytes, p + 30);
      var commentLength = readU16(bytes, p + 32);
      var localOffset = readU32(bytes, p + 42);
      var next = p + 46 + nameLen + extraLen + commentLength;
      if (nameLen < 0 || extraLen < 0 || commentLength < 0 || next > bytes.length) {
        entries.length = 0;
        entries.reason = 'ZIP 条目长度无效（文件可能已损坏）';
        return entries;
      }
      var fileName = decodeUtf8(bytes.subarray(p + 46, p + 46 + nameLen));

      if (compSize === 0xffffffff || origSize === 0xffffffff || localOffset === 0xffffffff) {
        entries.zip64 = true;
        p = next;
        continue;
      }
      if (localOffset + 30 > bytes.length || readU32(bytes, localOffset) !== SIG_LOCAL) {
        entries.length = 0;
        entries.reason = 'ZIP 本地文件头无效（文件可能已损坏）';
        return entries;
      }
      /* 必须使用 local header 自己的长度；central 与 local 的 extra 可不同。 */
      var localNameLen = readU16(bytes, localOffset + 26);
      var localExtraLen = readU16(bytes, localOffset + 28);
      var dataOffset = localOffset + 30 + localNameLen + localExtraLen;
      if (localNameLen < 0 || localExtraLen < 0 || dataOffset < 0 ||
          dataOffset + compSize > bytes.length) {
        entries.length = 0;
        entries.reason = 'ZIP 压缩数据越界（文件可能已截断）';
        return entries;
      }
      var entry = {
        name: fileName,
        method: method,
        compSize: compSize,
        origSize: origSize,
        offset: dataOffset
      };
      try {
        Object.defineProperty(entry, 'encrypted', { value: !!(flags & 1), enumerable: false });
      } catch (metaError) {
        entry.encrypted = !!(flags & 1);
      }
      entries.push(entry);
      p = next;
    }
    if (entries.length === 0 && !entries.reason) {
      entries.reason = entries.zip64 ? '暂不支持 ZIP64 格式的 Excel 文件' : 'ZIP 中没有文件条目';
    }
    return entries;
  }

  /**
   * 解压单个 ZIP 条目。method 0 直接复制；method 8 调用调用方注入的 raw DEFLATE 函数。
   * inflateFn 可同步返回 Uint8Array，也可返回 Promise<Uint8Array>。
   */
  function inflateEntry(input, entry, inflateFn) {
    var bytes = toBytes(input);
    if (!bytes || !entry || typeof entry !== 'object') {
      throw new Error('ZIP 条目或字节数据无效');
    }
    if (entry.encrypted) { throw new Error('Excel 文件已加密，无法读取'); }
    var offset = Number(entry.offset);
    var size = Number(entry.compSize);
    if (!isFinite(offset) || !isFinite(size) || offset < 0 || size < 0 ||
        offset + size > bytes.length) {
      throw new Error('ZIP 条目数据越界');
    }
    var compressed = bytes.subarray(offset, offset + size);
    if (entry.method === 0) {
      return typeof compressed.slice === 'function'
        ? compressed.slice(0) : new Uint8Array(compressed);
    }
    if (entry.method === 8) {
      if (typeof inflateFn !== 'function') { throw new Error('缺少 DEFLATE 解压函数'); }
      return inflateFn(compressed);
    }
    throw new Error('不支持 ZIP 压缩方法 ' + entry.method);
  }

  /** XML 实体解码（预定义实体 + 十进制/十六进制数字实体）。 */
  function decodeXmlEntities(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, function (all, body) {
        var cp = body.charAt(0).toLowerCase() === 'x'
          ? parseInt(body.slice(1), 16) : parseInt(body, 10);
        if (!isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
          return '\ufffd';
        }
        if (cp <= 0xffff) { return String.fromCharCode(cp); }
        cp -= 0x10000;
        return String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      })
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
  }

  /** 读取 XML 属性（XML 属性必须带引号）；不存在返回空串。 */
  function attrValue(attrs, name) {
    var safeName = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(?:^|\\s)' + safeName + '\\s*=\\s*(["\\\'])([\\s\\S]*?)\\1', 'i');
    var match = re.exec(String(attrs || ''));
    return match ? decodeXmlEntities(match[2]) : '';
  }

  /** 提取一个 XML 片段里的全部 <t>，支持 sharedStrings 富文本多段拼接。 */
  function textNodes(xml) {
    var out = '';
    var re = /<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t\s*>/gi;
    var match;
    while ((match = re.exec(String(xml || '')))) {
      out += decodeXmlEntities(match[1]);
    }
    return out;
  }

  /** 解析 xl/sharedStrings.xml。 */
  function decodeSharedStrings(xml) {
    var source = typeof xml === 'string' ? xml : '';
    var values = [];
    var re = /<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si\s*>|<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*\/>/gi;
    var match;
    while ((match = re.exec(source))) { values.push(match[1] ? textNodes(match[1]) : ''); }
    return values;
  }

  /** 单元格引用 A1 / AA20 转为 0 基列号；非法引用返回 -1。 */
  function columnIndex(ref) {
    var match = /^([A-Z]+)[0-9]+$/i.exec(String(ref || ''));
    if (!match) { return -1; }
    var letters = match[1].toUpperCase();
    var value = 0;
    var i;
    for (i = 0; i < letters.length; i++) {
      value = value * 26 + letters.charCodeAt(i) - 64;
    }
    return value - 1;
  }

  /** 取单元格 <v> 文本；空标签/不存在均为空串。 */
  function cellValueNode(body) {
    var match = /<(?:[A-Za-z_][\w.-]*:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v\s*>/i.exec(body);
    if (match) { return decodeXmlEntities(match[1]); }
    return '';
  }

  /** 两位补零。 */
  function pad2(n) {
    var s = String(Number(n) || 0);
    return s.length < 2 ? '0' + s : s;
  }

  /**
   * 内置日期/时间格式 id（OOXML 标准区间）。落在这些 id 上的单元格一律按日期处理。
   * 来源：ECMA-376 的 numFmtId 约定（14-22 / 27-36 / 45-47 / 50-58 / 71-81）。
   */
  var BUILTIN_DATE_FMT_IDS = (function () {
    var set = {};
    var ranges = [[14, 22], [27, 36], [45, 47], [50, 58], [71, 81]];
    var i;
    var j;
    for (i = 0; i < ranges.length; i++) {
      for (j = ranges[i][0]; j <= ranges[i][1]; j++) { set[j] = true; }
    }
    return set;
  })();

  /** 判断自定义 formatCode 是否描述日期/时间（去除方括号与引号常量后扫描日期字母）。 */
  function isDateFormatCode(code) {
    var c = String(code || '').toLowerCase();
    if (!c) { return false; }
    c = c.replace(/\[[^\]]*\]/g, ''); // 区域/颜色/条件等方括号内容
    c = c.replace(/"[^"]*"/g, '');    // 引号包裹的常数字面量
    return /[ymdhs]/.test(c);         // 日期时间格式必含 y/m/d/h/s 之一
  }

  /**
   * 解析 xl/styles.xml，返回「样式索引 → 是否日期格式」的布尔数组。
   * 索引即单元格 s 属性的值。仅扫描 <cellXfs> 块，避免 cellStyleXfs 等干扰对齐。
   */
  function parseDateStyleMap(xml) {
    var source = typeof xml === 'string' ? xml : '';
    var result = [];
    if (!source) { return result; }
    try {
      var custom = {};
      var numFmtRe = /<(?:[A-Za-z_][\w.-]*:)?numFmt\b([^>]*)\/?\s*>/gi;
      var m;
      while ((m = numFmtRe.exec(source))) {
        var id = parseInt(attrValue(m[1], 'numFmtId'), 10);
        var code = attrValue(m[1], 'formatCode');
        if (isFinite(id) && code) { custom[id] = code; }
      }
      var cellXfsMatch = /<(?:[A-Za-z_][\w.-]*:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?cellXfs\s*>/i.exec(source);
      var xfsBody = cellXfsMatch ? cellXfsMatch[1] : '';
      var xfsRe = /<(?:[A-Za-z_][\w.-]*:)?xf\b([^>]*)\/?\s*>/gi;
      var xf;
      while ((xf = xfsRe.exec(xfsBody))) {
        var numFmtId = parseInt(attrValue(xf[1], 'numFmtId'), 10);
        var applyNumberFormat = attrValue(xf[1], 'applyNumberFormat');
        var isDate = false;
        if (isFinite(numFmtId)) {
          if (BUILTIN_DATE_FMT_IDS[numFmtId]) {
            isDate = true;
          } else if (custom.hasOwnProperty(numFmtId) && custom[numFmtId]) {
            isDate = isDateFormatCode(custom[numFmtId]);
          }
        }
        if (applyNumberFormat === '0') { isDate = false; }
        result.push(isDate);
      }
    } catch (e) {
      /* 解析失败则回退为空映射，不转换任何日期。 */
    }
    return result;
  }

  /**
   * 把 Excel 序列号还原成 ISO 本地日期时间字符串 'YYYY-MM-DD HH:mm:ss'（UTC 无偏移）。
   * Excel 1900 日期系统：序列号 1 = 1900-01-01（含历史 leap-year bug，对 1900-03-01
   * 之后的现代日期无影响）。用 1899-12-30 作起点是业界通用写法。
   */
  function excelSerialToDateString(serial) {
    var s = Number(serial);
    if (!isFinite(s)) { return ''; }
    var MS_PER_DAY = 86400000;
    var epoch = Date.UTC(1899, 11, 30);
    var ms = Math.round(s * MS_PER_DAY) + epoch;
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
      ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
  }

  /**
   * 解析 worksheet XML 为二维数组；按 r="C1" 补齐缺失列，全空行跳过。
   * dateStyleMap 非空时，被标记为日期格式的单元格（其 <v> 为 Excel 序列号）会被
   * 还原成 'YYYY-MM-DD HH:mm:ss'，避免导入账单时日期变成荒谬年份。
   */
  function sheetToRows(xml, sharedStrings, dateStyleMap) {
    var source = typeof xml === 'string' ? xml : '';
    var shared = Array.isArray(sharedStrings) ? sharedStrings : [];
    var rows = [];
    var rowRe = /<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row\s*>|<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)\/>/gi;
    var rowMatch;
    while ((rowMatch = rowRe.exec(source))) {
      var rowBody = rowMatch[2] || '';
      var values = [];
      var maxColumn = -1;
      var nextColumn = 0;
      var cellRe = /<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c\s*>|<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*)\/>/gi;
      var cellMatch;
      while ((cellMatch = cellRe.exec(rowBody))) {
        var attrs = cellMatch[1] || cellMatch[3] || '';
        var body = cellMatch[2] || '';
        var explicitColumn = columnIndex(attrValue(attrs, 'r'));
        var col = explicitColumn >= 0 ? explicitColumn : nextColumn;
        nextColumn = col + 1;
        if (col > maxColumn) { maxColumn = col; }
        var type = attrValue(attrs, 't').toLowerCase();
        var styleIndex = parseInt(attrValue(attrs, 's'), 10);
        var raw = cellValueNode(body);
        var value = '';
        if (type === 's') {
          var sharedIndex = parseInt(raw, 10);
          value = isFinite(sharedIndex) && sharedIndex >= 0 && sharedIndex < shared.length
            ? String(shared[sharedIndex]) : '';
        } else if (type === 'inlinestr') {
          var inlineMatch = /<(?:[A-Za-z_][\w.-]*:)?is\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?is\s*>/i.exec(body);
          value = inlineMatch ? textNodes(inlineMatch[1]) : textNodes(body);
        } else if (type === 'b') {
          value = (raw === '1' || String(raw).toLowerCase() === 'true') ? 'true' : 'false';
        } else {
          /* t="str" 与默认数字都取 <v>；保持原始字符串精度。 */
          value = raw;
          /* 日期单元格以序列号数值存储；若样式被标记为日期格式则还原为可读时间。 */
          if (dateStyleMap && dateStyleMap.length && isFinite(styleIndex) && styleIndex >= 0 &&
              dateStyleMap[styleIndex] && /^-?\d+(\.\d+)?$/.test(raw)) {
            value = excelSerialToDateString(parseFloat(raw));
          }
        }
        values[col] = value;
      }
      if (maxColumn < 0) { continue; }
      var i;
      var hasValue = false;
      for (i = 0; i <= maxColumn; i++) {
        if (values[i] === undefined || values[i] === null) { values[i] = ''; }
        if (String(values[i]).trim() !== '') { hasValue = true; }
      }
      if (hasValue) { rows.push(values); }
    }
    return rows;
  }

  function normalizeZipPath(path) {
    var raw = String(path || '').replace(/\\/g, '/');
    if (raw.charAt(0) === '/') { raw = raw.slice(1); }
    var parts = raw.split('/');
    var out = [];
    var i;
    for (i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i] === '.') { continue; }
      if (parts[i] === '..') { if (out.length) { out.pop(); } }
      else { out.push(parts[i]); }
    }
    return out.join('/');
  }

  function findEntry(entries, name) {
    if (!Array.isArray(entries)) { return null; }
    var wanted = normalizeZipPath(name).toLowerCase();
    var i;
    for (i = 0; i < entries.length; i++) {
      if (normalizeZipPath(entries[i].name).toLowerCase() === wanted) { return entries[i]; }
    }
    return null;
  }

  function entryText(entry, contents) {
    if (!entry) { return ''; }
    var map = contents && typeof contents === 'object' ? contents : {};
    if (typeof map[entry.name] === 'string') { return map[entry.name]; }
    var normalized = normalizeZipPath(entry.name);
    if (typeof map[normalized] === 'string') { return map[normalized]; }
    return typeof entry.text === 'string' ? entry.text : '';
  }

  /**
   * 按 workbook.xml 的首个有名称 sheet 与 workbook.xml.rels 映射选择工作表。
   * contents 为可选 name→XML 文本映射；缺少 workbook/rels 时回退 worksheets 下排序首项。
   */
  function pickSheetName(entries, contents) {
    try {
      if (!Array.isArray(entries)) { return ''; }
      var workbookEntry = findEntry(entries, 'xl/workbook.xml');
      var relsEntry = findEntry(entries, 'xl/_rels/workbook.xml.rels');
      var workbookXml = entryText(workbookEntry, contents);
      var relsXml = entryText(relsEntry, contents);
      if (workbookXml && relsXml) {
        var relationships = {};
        var relRe = /<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/gi;
        var relMatch;
        while ((relMatch = relRe.exec(relsXml))) {
          var relId = attrValue(relMatch[1], 'Id');
          var target = attrValue(relMatch[1], 'Target');
          if (relId && target) {
            var resolved = /^\/?xl\//i.test(target)
              ? normalizeZipPath(target) : normalizeZipPath('xl/' + target);
            relationships[relId] = resolved;
          }
        }
        var sheetRe = /<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?\s*>/gi;
        var sheetMatch;
        while ((sheetMatch = sheetRe.exec(workbookXml))) {
          var sheetName = attrValue(sheetMatch[1], 'name');
          var relationId = attrValue(sheetMatch[1], 'r:id');
          if (!relationId) {
            var anyId = /(?:^|\s)[A-Za-z_][\w.-]*:id\s*=\s*(["'])([\s\S]*?)\1/i.exec(sheetMatch[1]);
            relationId = anyId ? decodeXmlEntities(anyId[2]) : '';
          }
          if (sheetName && relationId && relationships[relationId] &&
              findEntry(entries, relationships[relationId])) {
            return relationships[relationId];
          }
        }
      }
      var fallback = entries.filter(function (entry) {
        return /^xl\/worksheets\/[^/]+\.xml$/i.test(normalizeZipPath(entry.name));
      }).map(function (entry) { return normalizeZipPath(entry.name); });
      fallback.sort(function (a, b) {
        var al = a.toLowerCase();
        var bl = b.toLowerCase();
        return al < bl ? -1 : (al > bl ? 1 : 0);
      });
      return fallback.length ? fallback[0] : '';
    } catch (e) {
      return '';
    }
  }

  /** 二维数组转标准 CSV；逗号、引号、换行字段按 RFC 4180 方式转义。 */
  function rowsToCsv(rows) {
    if (!Array.isArray(rows)) { return ''; }
    return rows.map(function (row) {
      var cells = Array.isArray(row) ? row : [row];
      return cells.map(function (cell) {
        var value = cell === null || cell === undefined ? '' : String(cell);
        if (/[",\r\n]/.test(value)) { return '"' + value.replace(/"/g, '""') + '"'; }
        return value;
      }).join(',');
    }).join('\n');
  }

  function failure(reason) {
    return { ok: false, reason: String(reason || 'Excel 文件解析失败') };
  }

  function errorReason(error) {
    var message = error && error.message ? String(error.message) : String(error || '');
    if (message.indexOf('当前浏览器不支持解压 Excel') !== -1) { return message; }
    if (message.indexOf('加密') !== -1) { return 'Excel 文件已加密，无法读取'; }
    return 'Excel 压缩数据解压失败' + (message ? '：' + message : '');
  }

  /**
   * 把 .xlsx 字节转换为 CSV 文本。
   * inflateFn 同步时本函数同步返回结果；inflateFn 返回 Promise 时，本函数返回 Promise<结果>。
   * 任意格式错误都会变成 {ok:false, reason}（或 resolve 到该对象），绝不把异常抛给调用方。
   */
  function toCsvText(input, inflateFn) {
    try {
      var bytes = toBytes(input);
      if (!bytes || bytes.length === 0) { return failure('Excel 文件内容为空'); }
      var entries = listEntries(bytes);
      if (!entries.length) { return failure(entries.reason || 'Excel ZIP 中没有可读取的文件'); }
      if (entries.zip64) { return failure('暂不支持 ZIP64 格式的超大 Excel 文件'); }

      var wanted = entries.filter(function (entry) {
        var name = normalizeZipPath(entry.name);
        return /^xl\/workbook\.xml$/i.test(name) ||
          /^xl\/_rels\/workbook\.xml\.rels$/i.test(name) ||
          /^xl\/sharedStrings\.xml$/i.test(name) ||
          /^xl\/styles\.xml$/i.test(name) ||
          /^xl\/worksheets\/[^/]+\.xml$/i.test(name);
      });
      if (!wanted.some(function (entry) {
        return /^xl\/worksheets\/[^/]+\.xml$/i.test(normalizeZipPath(entry.name));
      })) {
        return failure('Excel 中找不到工作表数据');
      }

      var totalSize = 0;
      var i;
      for (i = 0; i < wanted.length; i++) {
        if (wanted[i].encrypted) { return failure('Excel 文件已加密，无法读取'); }
        if (wanted[i].origSize > MAX_ENTRY_SIZE) { return failure('Excel 工作表过大，无法安全读取'); }
        totalSize += wanted[i].origSize;
        if (totalSize > MAX_TOTAL_SIZE) { return failure('Excel 工作簿过大，无法安全读取'); }
      }

      var inflated = [];
      var hasPromise = false;
      for (i = 0; i < wanted.length; i++) {
        var item = inflateEntry(bytes, wanted[i], inflateFn);
        if (item && typeof item.then === 'function') { hasPromise = true; }
        inflated.push(item);
      }

      function build(outputs) {
        try {
          var contents = {};
          var j;
          for (j = 0; j < wanted.length; j++) {
            var outputBytes = toBytes(outputs[j]);
            if (!outputBytes) { return failure('Excel 解压结果不是有效字节数据'); }
            contents[wanted[j].name] = decodeUtf8(outputBytes).replace(/^\ufeff/, '');
          }
          var sheetName = pickSheetName(entries, contents);
          if (!sheetName) { return failure('Excel 中找不到可读取的工作表'); }
          var sheetEntry = findEntry(entries, sheetName);
          var sheetXml = entryText(sheetEntry, contents);
          if (!sheetXml) { return failure('Excel 工作表内容为空或无法读取'); }
          var sharedEntry = findEntry(entries, 'xl/sharedStrings.xml');
          var shared = sharedEntry ? decodeSharedStrings(entryText(sharedEntry, contents)) : [];
          var stylesEntry = findEntry(entries, 'xl/styles.xml');
          var dateStyleMap = stylesEntry ? parseDateStyleMap(entryText(stylesEntry, contents)) : [];
          var rows = sheetToRows(sheetXml, shared, dateStyleMap);
          if (!rows.length) { return failure('Excel 工作表中没有可导入的数据行'); }
          return { ok: true, text: rowsToCsv(rows), sheet: sheetName, rowCount: rows.length };
        } catch (buildError) {
          return failure(errorReason(buildError));
        }
      }

      if (hasPromise) {
        return Promise.all(inflated.map(function (item) { return Promise.resolve(item); }))
          .then(build)
          .catch(function (error) { return failure(errorReason(error)); });
      }
      return build(inflated);
    } catch (error) {
      return failure(errorReason(error));
    }
  }

  var API = {
    isXlsx: isXlsx,
    listEntries: listEntries,
    inflateEntry: inflateEntry,
    decodeSharedStrings: decodeSharedStrings,
    sheetToRows: sheetToRows,
    parseDateStyleMap: parseDateStyleMap,
    pickSheetName: pickSheetName,
    rowsToCsv: rowsToCsv,
    toCsvText: toCsvText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    global.AJ = global.AJ || {};
    global.AJ.xlsx = API;
  }
})(typeof window !== 'undefined' ? window : this);
