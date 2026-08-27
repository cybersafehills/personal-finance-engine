// Minimal QR Code generator - byte mode, auto version (1-40), automatic
// mask selection. Dependency-free and pure so it runs in a Deno unit
// test and a React client component, and emits no network requests
// (CSP-safe). Adapted from the public-domain algorithm described in
// ISO/IEC 18004 and Nayuki's reference implementation.
//
// Used only to render a USSD/tel: route as a scannable image for the
// desktop -> phone hand-off. The encoded string carries a phone number
// and amount (not secrets); a PIN never appears in it.

export type Ecc = "L" | "M" | "Q" | "H";

const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
const ECC_INDEX: Record<Ecc, number> = { L: 0, M: 1, Q: 2, H: 3 };

function getNumRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(ver: number, ecc: Ecc): number {
  const e = ECC_INDEX[ecc];
  return (
    Math.floor(getNumRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[e][ver] * NUM_ERROR_CORRECTION_BLOCKS[e][ver]
  );
}

// --- Reed-Solomon over GF(256) ---
function rsGeneratorPoly(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsRemainder(data: number[], generator: number[]): number[] {
  const result = new Array<number>(generator.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    for (let j = 0; j < result.length; j++) result[j] ^= gfMul(generator[j], factor);
  }
  return result;
}

type BitBuffer = number[];
function appendBits(bb: BitBuffer, val: number, len: number): void {
  for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
}

export type QrMatrix = {
  size: number;
  /** row-major booleans; true = dark module. */
  modules: boolean[][];
};

/** Encode `text` (UTF-8, byte mode) into the smallest QR version that
 *  fits at the given ECC level. Throws if it does not fit in version 40. */
export function encodeQr(text: string, ecc: Ecc = "M"): QrMatrix {
  const bytes = Array.from(new TextEncoder().encode(text));

  let version = 1;
  let dataCapacityBits = 0;
  for (; version <= 40; version++) {
    dataCapacityBits = getNumDataCodewords(version, ecc) * 8;
    const charCountBits = version < 10 ? 8 : 16;
    const needed = 4 + charCountBits + bytes.length * 8;
    if (needed <= dataCapacityBits) break;
    if (version === 40) throw new Error("qr: data too long");
  }

  const bb: BitBuffer = [];
  appendBits(bb, 0b0100, 4); // byte mode
  appendBits(bb, bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) appendBits(bb, b, 8);
  appendBits(bb, 0, Math.min(4, dataCapacityBits - bb.length)); // terminator
  while (bb.length % 8 !== 0) bb.push(0);
  for (let pad = 0xec; bb.length < dataCapacityBits; pad ^= 0xec ^ 0x11) {
    appendBits(bb, pad, 8);
  }

  const dataCodewords: number[] = [];
  for (let i = 0; i < bb.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bb[i + j];
    dataCodewords.push(byte);
  }

  const allCodewords = addEccAndInterleave(dataCodewords, version, ecc);
  return drawMatrix(allCodewords, version, ecc);
}

function addEccAndInterleave(data: number[], ver: number, ecc: Ecc): number[] {
  const e = ECC_INDEX[ecc];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[e][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e][ver];
  const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const gen = rsGeneratorPoly(blockEccLen);
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const eccBytes = rsRemainder(dat, gen);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(eccBytes));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result.push(blocks[j][i]);
      }
    }
  }
  return result;
}

function drawMatrix(codewords: number[], ver: number, ecc: Ecc): QrMatrix {
  const size = ver * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const setFn = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  // Timing patterns
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  // Finder patterns + separators
  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  // Alignment patterns
  const alignPositions = getAlignmentPatternPositions(ver);
  for (const cy of alignPositions) {
    for (const cx of alignPositions) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) {
        continue;
      }
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve format + version info areas (filled per-mask below).
  reserveFormatInfo(size, setFn);
  if (ver >= 7) reserveVersionInfo(size, setFn);

  // Place data bits (zig-zag), then try all 8 masks and keep the best.
  const dataBits: number[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) dataBits.push((cw >>> i) & 1);

  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIndex < dataBits.length) {
          modules[y][x] = dataBits[bitIndex] === 1;
          bitIndex++;
        }
      }
    }
  }

  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestModules = modules;
  for (let mask = 0; mask < 8; mask++) {
    const trial = modules.map((row) => row.slice());
    applyMask(trial, isFunction, mask);
    drawFormatBits(trial, isFunction, size, ecc, mask);
    const penalty = computePenalty(trial, size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestModules = trial;
    }
  }
  void bestMask;

  return { size, modules: bestModules };
}

function getAlignmentPatternPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function reserveFormatInfo(size: number, setFn: (x: number, y: number, d: boolean) => void): void {
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) setFn(i, 8, false);
    if (i !== 6) setFn(8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    setFn(size - 1 - i, 8, false);
    setFn(8, size - 1 - i, false);
  }
  setFn(8, size - 8, true); // dark module
}

function reserveVersionInfo(size: number, setFn: (x: number, y: number, d: boolean) => void): void {
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFn(a, b, false);
    setFn(b, a, false);
  }
}

function applyMask(modules: boolean[][], isFunction: boolean[][], mask: number): void {
  const size = modules.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFunction[y][x]) continue;
      let invert = false;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (invert) modules[y][x] = !modules[y][x];
    }
  }
}

function drawFormatBits(
  modules: boolean[][],
  isFunction: boolean[][],
  size: number,
  ecc: Ecc,
  mask: number,
): void {
  const eccBits = { L: 1, M: 0, Q: 3, H: 2 }[ecc];
  const data = (eccBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) modules[8][i] = ((bits >>> i) & 1) !== 0;
  modules[8][7] = ((bits >>> 6) & 1) !== 0;
  modules[8][8] = ((bits >>> 7) & 1) !== 0;
  modules[7][8] = ((bits >>> 8) & 1) !== 0;
  for (let i = 9; i < 15; i++) modules[14 - i][8] = ((bits >>> i) & 1) !== 0;

  for (let i = 0; i < 8; i++) modules[size - 1 - i][8] = ((bits >>> i) & 1) !== 0;
  for (let i = 8; i < 15; i++) modules[8][size - 15 + i] = ((bits >>> i) & 1) !== 0;
  modules[size - 8][8] = true;
  void isFunction;
}

function computePenalty(modules: boolean[][], size: number): number {
  let penalty = 0;
  // Rule 1: runs of 5+ same-colour in a row/column.
  for (let y = 0; y < size; y++) {
    let runColor = modules[y][0];
    let runLen = 1;
    for (let x = 1; x < size; x++) {
      if (modules[y][x] === runColor) {
        runLen++;
        if (runLen === 5) penalty += 3;
        else if (runLen > 5) penalty++;
      } else {
        runColor = modules[y][x];
        runLen = 1;
      }
    }
  }
  for (let x = 0; x < size; x++) {
    let runColor = modules[0][x];
    let runLen = 1;
    for (let y = 1; y < size; y++) {
      if (modules[y][x] === runColor) {
        runLen++;
        if (runLen === 5) penalty += 3;
        else if (runLen > 5) penalty++;
      } else {
        runColor = modules[y][x];
        runLen = 1;
      }
    }
  }
  // Rule 2: 2x2 blocks of same colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
        penalty += 3;
      }
    }
  }
  // Rule 4: proportion of dark modules.
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++;
  const total = size * size;
  const ratio = Math.abs(dark * 20 - total * 10) / total;
  penalty += Math.floor(ratio) * 10;
  return penalty;
}

/** Render a QrMatrix as a self-contained SVG string (no external refs).
 *  `fg`/`bg` default to `currentColor` / `transparent` so it inherits
 *  the surrounding text colour and works in light and dark themes. */
export function qrToSvg(
  matrix: QrMatrix,
  opts: { quietZone?: number; fg?: string; bg?: string; sizePx?: number } = {},
): string {
  const quiet = opts.quietZone ?? 4;
  const fg = opts.fg ?? "currentColor";
  const bg = opts.bg ?? "transparent";
  const dim = matrix.size + quiet * 2;
  const px = opts.sizePx ?? 256;
  let path = "";
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.modules[y][x]) path += `M${x + quiet},${y + quiet}h1v1h-1z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${px}" height="${px}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="${bg}"/>` +
    `<path d="${path}" fill="${fg}"/>` +
    `</svg>`
  );
}
