/**
 * CBL decoder + FEN validator
 * Board: row 0 = black home (rank 10), row 9 = red home (rank 1)
 *        col 0='a' .. col 8='i'
 * sq = row * 9 + col
 *
 * Confirmed by position-frequency analysis across all 113 records:
 *   0x15 = red K  — always found in red palace (rows7-9, cols3-5)
 *   0x25 = black k — always found in black palace (rows0-2, cols3-5)
 *   0x23 (×2/rec) appear at c10+e8 = black territory → likely black elephant (b)
 *   0x24 at f10 (palace row) → likely black advisor (a)
 *   0x21,0x22,0x26 appear at rank 2 from red (red territory)
 *      → must be crossable pieces: n, r, c, or p  (NOT a or b!)
 *   0x12 (100% red), 0x16 (99% red) = horse+cannon in some order
 *   0x13 (×2/rec, red territory) → likely red elephant (B)
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { default: ffishModule } = require('../node_modules/ffish-es6/ffish.js');
const wasmBinary = readFileSync('./node_modules/ffish-es6/ffish.wasm');

const CBL_PATH = 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/馬後炮.CBL';
const NUM_RECORDS = 113;
const RECORD_SIZE = 0x1000;
const FIRST_RECORD_OFFSET = 0x18e40;
const BOARD_OFFSET_IN_RECORD = 0x848;

// ffish xiangqi piece letters (uppercase=red, lowercase=black):
// K=king, A=advisor, B=elephant, N=horse, R=rook, C=cannon, P=pawn
// All candidates keep 0x15=K, 0x25=k, 0x13=B(×2), 0x23=b(×2), 0x24=a
// 0x12 and 0x16 swap between N and C (horse & cannon for 馬後炮)
// 0x21, 0x22, 0x26 are forced to be crossable (n/r/c/p) not a/b

const ENCODINGS = [
  // Red:   11=A 12=N 13=B 14=R 15=K 16=C 17=P
  // Black: 21=n 22=r 23=b 24=a 25=k 26=c 27=p
  { label: 'F1: r21=n,r22=r,r26=c,r27=p',
    red:  {0x11:'A',0x12:'N',0x13:'B',0x14:'R',0x15:'K',0x16:'C',0x17:'P'},
    black:{0x21:'n',0x22:'r',0x23:'b',0x24:'a',0x25:'k',0x26:'c',0x27:'p'} },
  { label: 'F2: r21=r,r22=n,r26=c,r27=p',
    red:  {0x11:'A',0x12:'N',0x13:'B',0x14:'R',0x15:'K',0x16:'C',0x17:'P'},
    black:{0x21:'r',0x22:'n',0x23:'b',0x24:'a',0x25:'k',0x26:'c',0x27:'p'} },
  { label: 'F3: r21=c,r22=r,r26=n,r27=p',
    red:  {0x11:'A',0x12:'N',0x13:'B',0x14:'R',0x15:'K',0x16:'C',0x17:'P'},
    black:{0x21:'c',0x22:'r',0x23:'b',0x24:'a',0x25:'k',0x26:'n',0x27:'p'} },
  { label: 'F4: r21=r,r22=c,r26=n,r27=p',
    red:  {0x11:'A',0x12:'N',0x13:'B',0x14:'R',0x15:'K',0x16:'C',0x17:'P'},
    black:{0x21:'r',0x22:'c',0x23:'b',0x24:'a',0x25:'k',0x26:'n',0x27:'p'} },
  { label: 'F5: r21=n,r22=c,r26=r,r27=p',
    red:  {0x11:'A',0x12:'N',0x13:'B',0x14:'R',0x15:'K',0x16:'C',0x17:'P'},
    black:{0x21:'n',0x22:'c',0x23:'b',0x24:'a',0x25:'k',0x26:'r',0x27:'p'} },
  { label: 'F6: r21=c,r22=n,r26=r,r27=p',
    red:  {0x11:'A',0x12:'N',0x13:'B',0x14:'R',0x15:'K',0x16:'C',0x17:'P'},
    black:{0x21:'c',0x22:'n',0x23:'b',0x24:'a',0x25:'k',0x26:'r',0x27:'p'} },
  // Swap 0x12/0x16 for red (N↔C)
  { label: 'G1: 12=C,16=N | r21=n,r22=r,r26=c',
    red:  {0x11:'A',0x12:'C',0x13:'B',0x14:'R',0x15:'K',0x16:'N',0x17:'P'},
    black:{0x21:'n',0x22:'r',0x23:'b',0x24:'a',0x25:'k',0x26:'c',0x27:'p'} },
  { label: 'G2: 12=C,16=N | r21=r,r22=c,r26=n',
    red:  {0x11:'A',0x12:'C',0x13:'B',0x14:'R',0x15:'K',0x16:'N',0x17:'P'},
    black:{0x21:'r',0x22:'c',0x23:'b',0x24:'a',0x25:'k',0x26:'n',0x27:'p'} },
  // Try 0x27=a (second advisor instead of pawn), 0x21=p
  { label: 'H1: 27=a,21=p,22=r,26=c',
    red:  {0x11:'A',0x12:'N',0x13:'B',0x14:'R',0x15:'K',0x16:'C',0x17:'P'},
    black:{0x21:'p',0x22:'r',0x23:'b',0x24:'a',0x25:'k',0x26:'c',0x27:'a'} },
  { label: 'H2: 27=a,21=r,22=p,26=c',
    red:  {0x11:'A',0x12:'N',0x13:'B',0x14:'R',0x15:'K',0x16:'C',0x17:'P'},
    black:{0x21:'r',0x22:'p',0x23:'b',0x24:'a',0x25:'k',0x26:'c',0x27:'a'} },
];

function boardToFen(board90, enc) {
  const rows = [];
  for (let row = 0; row < 10; row++) {
    let rankStr = '';
    let empty = 0;
    for (let col = 0; col < 9; col++) {
      const b = board90[row * 9 + col];
      const isRed = enc.red[b] !== undefined;
      const isBlack = enc.black[b] !== undefined;
      const piece = isRed ? enc.red[b].toUpperCase() : (isBlack ? enc.black[b].toLowerCase() : null);
      if (piece) {
        if (empty) { rankStr += empty; empty = 0; }
        rankStr += piece;
      } else {
        empty++;
      }
    }
    if (empty) rankStr += empty;
    rows.push(rankStr);
  }
  return rows.join('/') + ' w - - 0 1';
}

async function main() {
  const ffish = await ffishModule({ wasmBinary });
  const data = readFileSync(CBL_PATH);

  console.log('=== Encoding validation ===\n');
  let bestEnc = null, bestValid = 0;
  for (const enc of ENCODINGS) {
    let valid = 0, invalid = 0;
    for (let rec = 0; rec < NUM_RECORDS; rec++) {
      const boardStart = FIRST_RECORD_OFFSET + rec * RECORD_SIZE + BOARD_OFFSET_IN_RECORD;
      const board90 = Array.from(data.slice(boardStart, boardStart + 90));
      const fen = boardToFen(board90, enc);
      if (ffish.validateFen(fen, 'xiangqi') === 1) valid++; else invalid++;
    }
    const mark = valid > bestValid ? ' *** BEST' : '';
    console.log(`${enc.label}  →  valid=${valid}/${NUM_RECORDS}${mark}`);
    if (valid > bestValid) { bestValid = valid; bestEnc = enc; }
  }

  if (!bestEnc) { console.log('No valid encoding found'); return; }

  console.log(`\n=== First 5 boards (${bestValid} valid total) ===`);
  console.log(bestEnc.label + '\n');
  for (let rec = 0; rec < 5; rec++) {
    const boardStart = FIRST_RECORD_OFFSET + rec * RECORD_SIZE + BOARD_OFFSET_IN_RECORD;
    const board90 = Array.from(data.slice(boardStart, boardStart + 90));
    const fen = boardToFen(board90, bestEnc);
    console.log(`Record ${rec}  FEN: ${fen}`);
    const ok = ffish.validateFen(fen, 'xiangqi') === 1;
    if (ok) {
      const board = new ffish.Board('xiangqi', fen);
      console.log(board.toString());
      board.delete();
    } else {
      console.log('  (invalid)');
    }
  }
}

main().catch(console.error);
