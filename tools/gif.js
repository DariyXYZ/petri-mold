'use strict';

// Минимальный энкодер GIF89a: индексированные кадры, глобальная палитра, цикл.
// Без зависимостей — npm в этом окружении может быть недоступен, а формат
// простой: LZW переменной ширины кода плюс блоки по 255 байт.

function BitWriter() {
  this.out = [];        // готовые байты полезной нагрузки
  this.cur = 0;
  this.bits = 0;
}

BitWriter.prototype.write = function (code, size) {
  this.cur |= code << this.bits;
  this.bits += size;
  while (this.bits >= 8) {
    this.out.push(this.cur & 0xff);
    this.cur >>= 8;
    this.bits -= 8;
  }
};

BitWriter.prototype.flush = function () {
  if (this.bits > 0) { this.out.push(this.cur & 0xff); this.cur = 0; this.bits = 0; }
  return this.out;
};

// LZW по спецификации GIF: код очистки 2^minCodeSize, EOI следом за ним,
// ширина кода растёт по мере наполнения словаря и сбрасывается на 4096.
function lzw(minCodeSize, px) {
  var clear = 1 << minCodeSize, eoi = clear + 1;
  var next = eoi + 1, size = minCodeSize + 1;
  var table = new Map();
  var w = new BitWriter();

  w.write(clear, size);
  var prev = px[0];
  for (var i = 1; i < px.length; i++) {
    var k = px[i];
    var key = (prev << 8) | k;
    var got = table.get(key);
    if (got !== undefined) { prev = got; continue; }

    w.write(prev, size);
    if (next === 4096) {
      w.write(clear, size);
      table = new Map();
      next = eoi + 1;
      size = minCodeSize + 1;
    } else {
      if (next >= (1 << size)) size++;
      table.set(key, next++);
    }
    prev = k;
  }
  w.write(prev, size);
  w.write(eoi, size);
  return w.flush();
}

function subBlocks(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i += 255) {
    var chunk = bytes.slice(i, i + 255);
    out.push(chunk.length);
    for (var j = 0; j < chunk.length; j++) out.push(chunk[j]);
  }
  out.push(0);
  return out;
}

// palette: массив [r,g,b] длиной 2^bits (2..256)
function Gif(width, height, palette) {
  this.w = width;
  this.h = height;
  this.bytes = [];

  var n = palette.length;
  var bits = 1;
  while ((1 << bits) < n) bits++;
  if (bits < 1) bits = 1;
  this.bits = bits;
  this.minCode = Math.max(2, bits);

  var b = this.bytes;
  push(b, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);          // GIF89a
  u16(b, width); u16(b, height);
  b.push(0xf0 | (bits - 1));                              // есть GCT, глубина
  b.push(0); b.push(0);

  var size = 1 << bits;
  for (var i = 0; i < size; i++) {
    var c = palette[i] || [0, 0, 0];
    b.push(c[0] & 0xff, c[1] & 0xff, c[2] & 0xff);
  }

  // расширение Netscape: бесконечный цикл
  push(b, [0x21, 0xff, 0x0b]);
  push(b, str('NETSCAPE2.0'));
  push(b, [0x03, 0x01, 0x00, 0x00, 0x00]);
}

// delayMs округляется до сотых долей секунды — шаг формата
Gif.prototype.frame = function (indices, delayMs) {
  var b = this.bytes;
  var cs = Math.max(2, Math.round(delayMs / 10));

  push(b, [0x21, 0xf9, 0x04, 0x00]);                      // GCE, без прозрачности
  u16(b, cs);
  push(b, [0x00, 0x00]);

  b.push(0x2c);                                           // дескриптор кадра
  u16(b, 0); u16(b, 0);
  u16(b, this.w); u16(b, this.h);
  b.push(0x00);

  b.push(this.minCode);
  push(b, subBlocks(lzw(this.minCode, indices)));
};

Gif.prototype.buffer = function () {
  var b = this.bytes.slice();
  b.push(0x3b);                                           // трейлер
  return Buffer.from(b);
};

function push(arr, src) { for (var i = 0; i < src.length; i++) arr.push(src[i]); }
function u16(arr, v) { arr.push(v & 0xff, (v >> 8) & 0xff); }
function str(s) { var a = []; for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i)); return a; }

module.exports = { Gif: Gif };
