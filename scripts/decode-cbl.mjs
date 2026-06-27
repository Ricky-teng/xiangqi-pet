/**
 * CBL decoder + FEN validator
 * Run: node scripts/decode-cbl.mjs
 *
 * Board layout:  row 0 = black home (rank 10), row 9 = red home (rank 1)
 *                col 0 = 'a' file, col 8 = 'i' file
 * sq = row * 9 + col
 *
 * Confirmed:
 *   0x15 = red K (帥)   — always in red palace (row 9, cols 3-5)
 *   0x25 = black K (將) — always in black palace (rows 0-2, cols 3-5)
 *   0x12, 0x16 = red H + C (essential for 馬後炮, order TBD)
 *
 * We'll try both orderings for H/C and report which gives valid FENs.
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Module = require('./node_modules/ffish-es6/ffish.js');

const CBL_PATH = 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/馬後炮.CBL';
const NUM_RECORDS = 113;
const RECORD_SIZE = 0x1000;
const FIRST_RECORD_OFFSET = 0x18e40;
const BOARD_OFFSET_IN_RECORD = 0x848;

// Try two candidate encodings for the 0x10 and 0x20 ranges
// Confirmed: 0x15=K, 0x25=k
// Hypothesis A: 0x12=H, 0x16=C
// Hypothesis B: 0x12=C, 0x16=H
const ENCODINGS = [
  {
    label: 'A: 0x12=H 0x13=E 0x14=R 0x16=C 0x17=P 0x11=A',
    red:   { 0x11:'A', 0x12:'H', 0x13:'E', 0x14:'R', 0x15:'K', 0x16:'C', 0x17:'P' },
    black: { 0x21:'a', 0x22:'h', 0x23:'e', 0x24:'r', 0x25:'k', 0x26:'c', 0x27:'p' },
  },
  {
    label: 'B: 0x12=C 0x13=E 0x14=R 0x16=H 0x17=P 0x11=A',
    red:   { 0x11:'A', 0x12:'C', 0x13:'E', 0x14:'R', 0x15:'K', 0x16:'H', 0x17:'P' },
    black: { 0x21:'a', 0x22:'c', 0x23:'e', 0x24:'r', 0x25:'k', 0x26:'h', 0x27:'p' },
  },
  {
    label: 'C: 0x12=H 0x13=A 0x14=R 0x16=C 0x17=P 0x11=E',
    red:   { 0x11:'E', 0x12:'H', 0x13:'A', 0x14:'R', 0x15:'K', 0x16:'C', 0x17:'P' },
    black: { 0x21:'e', 0x22:'h', 0x23:'a', 0x24:'r', 0x25:'k', 0x26:'c', 0x27:'p' },
  },
  {
    label: 'D: standard offset  0x11=A 0x12=E 0x13=H 0x14=R 0x15=K 0x16=C 0x17=P',
    red:   { 0x11:'A', 0x12:'E', 0x13:'H', 0x14:'R', 0x15:'K', 0x16:'C', 0x17:'P' },
    black: { 0x21:'a', 0x22:'e', 0x23:'h', 0x24:'r', 0x25:'k', 0x26:'c', 0x27:'p' },
  },
];

function boardToFen(board90, enc) {
  // board90: row 0 = black home (rank 10), row 9 = red home (rank 1)
  // FEN for xiangqi: ranks 10→1 (black home first), files a→i
  const appPieceMap = { 'K':'K','A':'A','E':'E','H':'H','R':'R','C':'C','P':'P',
                         'k':'k','a':'a','e':'e','h':'h','r':'r','c':'c','p':'p' };

  const rows = [];
  for (let row = 0; row < 10; row++) {
    let rankStr = '';
    let empty = 0;
    for (let col = 0; col < 9; col++) {
      const sq = row * 9 + col;
      const b = board90[sq];
      const piece = b ? (enc.red[b] || enc.black[b]) : null;
      if (piece) {
        if (empty > 0) { rankStr += empty; empty = 0; }
        // ffish uses n for horse, b for elephant in xiangqi
        const ffishPiece = piece
          .replace('H','N').replace('h','n')
          .replace('E','B').replace('e','b');
        rankStr += ffishPiece;
      } else {
        empty++;
      }
    }
    if (empty > 0) rankStr += empty;
    rows.push(rankStr);
  }
  return rows.join('/') + ' w - - 0 1';
}

async function main() {
  const ffish = await new Module();
  const data = readFileSync(CBL_PATH);

  for (const enc of ENCODINGS) {
    let valid = 0, invalid = 0;
    for (let rec = 0; rec < NUM_RECORDS; rec++) {
      const boardStart = FIRST_RECORD_OFFSET + rec * RECORD_SIZE + BOARD_OFFSET_IN_RECORD;
      const board90 = Array.from(data.slice(boardStart, boardStart + 90));
      const fen = boardToFen(board90, enc);
      const result = ffish.validateFen(fen, 'xiangqi');
      if (result === 1) valid++; else invalid++;
    }
    console.log(`${enc.label}`);
    console.log(`  valid=${valid}/${NUM_RECORDS}  invalid=${invalid}`);
  }

  // Print first 3 records with best encoding for visual check
  console.log('\n--- First 3 boards with encoding D (standard offset) ---');
  const enc = ENCODINGS[3];
  for (let rec = 0; rec < 3; rec++) {
    const boardStart = FIRST_RECORD_OFFSET + rec * RECORD_SIZE + BOARD_OFFSET_IN_RECORD;
    const board90 = Array.from(data.slice(boardStart, boardStart + 90));
    const fen = boardToFen(board90, enc);
    console.log(`Record ${rec}: ${fen}`);
    const board = new ffish.Board('xiangqi', fen);
    console.log(board.toString());
    board.delete();
  }
}

main().catch(console.error);
