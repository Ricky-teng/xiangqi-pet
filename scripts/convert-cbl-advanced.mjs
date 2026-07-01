/**
 * convert-cbl-advanced.mjs — 進階殺法 CBL → PuzzleDoc JSON
 *
 * 處理 2-進階殺法/ 目錄下 8 個 CBL 檔案。
 * 第一次 pass：MAX_DEPTH=7（4步殺以內），存到 cbl-puzzles-advanced.json。
 * 之後再跑 convert-cbl-advanced-deep.mjs 補 5~7步殺。
 */

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { randomBytes } from 'crypto';

const require = createRequire(import.meta.url);
const { default: ffishModule } = require('../node_modules/ffish-es6/ffish.js');
const wasmBinary = readFileSync('./node_modules/ffish-es6/ffish.wasm');

const NUM_RECORDS  = 113;
const FIRST_OFFSET = 0x18e40;
const BOARD_OFFSET = 0x848;
const MAX_DEPTH    = 7;

const RED = { 0x11:'R', 0x12:'N', 0x13:'B', 0x14:'A', 0x15:'K', 0x16:'C', 0x17:'P' };
const BLK = { 0x21:'r', 0x22:'n', 0x23:'b', 0x24:'a', 0x25:'k', 0x26:'c', 0x27:'p' };

function boardToFfishFen(board90) {
  const rows = [];
  for (let row = 0; row < 10; row++) {
    let s = '', empty = 0;
    for (let col = 0; col < 9; col++) {
      const b = board90[row * 9 + col];
      const p = RED[b] || BLK[b] || null;
      if (p) { if (empty) { s += empty; empty = 0; } s += p; }
      else empty++;
    }
    if (empty) s += empty;
    rows.push(s);
  }
  return rows.join('/') + ' w - - 0 1';
}

function ffishMoveToApp(mv) {
  const m = mv.match(/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/);
  if (!m) throw new Error('bad ffish move: ' + mv);
  return `${m[1]}${10 - Number(m[2])}${m[3]}${10 - Number(m[4])}`;
}

function ffishFenToApp(fen) {
  return fen.split(' ')[0].replace(/[NnBb]/g, c => ({ N:'H', n:'h', B:'E', b:'e' }[c]));
}

function findMate(board, depth) {
  if (depth === 0) return null;
  const isRedTurn = board.turn();
  const movesStr  = board.legalMoves();
  const moves     = movesStr ? movesStr.split(' ').filter(Boolean) : [];
  if (moves.length === 0) return isRedTurn ? null : [];

  if (isRedTurn) {
    const sorted = [];
    for (const mv of moves) {
      board.push(mv);
      const gives_check = board.isCheck();
      board.pop();
      if (gives_check) sorted.unshift(mv); else sorted.push(mv);
    }
    for (const mv of sorted) {
      board.push(mv);
      if (board.isGameOver() && board.result() === '1-0') { board.pop(); return [mv]; }
      const cont = findMate(board, depth - 1);
      board.pop();
      if (cont !== null) return [mv, ...cont];
    }
    return null;
  } else {
    let repLine = null;
    for (const mv of moves) {
      board.push(mv);
      const cont = findMate(board, depth - 1);
      board.pop();
      if (cont === null) return null;
      if (repLine === null) repLine = [mv, ...cont];
    }
    return repLine ?? null;
  }
}

function solvePosition(ffish, ffishFen) {
  for (let depth = 1; depth <= MAX_DEPTH; depth += 2) {
    const board = new ffish.Board('xiangqi', ffishFen);
    const result = findMate(board, depth);
    board.delete();
    if (result) return result;
  }
  return null;
}

const CBL_FILES = [
  { file: 'C:/Users/small/OneDrive/桌面/2-進階殺法/1-困斃.CBL',       title: '困斃' },
  { file: 'C:/Users/small/OneDrive/桌面/2-進階殺法/2-悶殺.CBL',       title: '悶殺' },
  { file: 'C:/Users/small/OneDrive/桌面/2-進階殺法/3-平頂冠.CBL',     title: '平頂冠' },
  { file: 'C:/Users/small/OneDrive/桌面/2-進階殺法/4-夾車包.CBL',     title: '夾車包' },
  { file: 'C:/Users/small/OneDrive/桌面/2-進階殺法/5-天地包.CBL',     title: '天地包' },
  { file: 'C:/Users/small/OneDrive/桌面/2-進階殺法/6-雙將殺.CBL',     title: '雙將殺' },
  { file: 'C:/Users/small/OneDrive/桌面/2-進階殺法/7-小鬼坐龍庭.CBL', title: '小鬼坐龍庭' },
  { file: 'C:/Users/small/OneDrive/桌面/2-進階殺法/8-兩鬼拍門.CBL',   title: '兩鬼拍門' },
];

const OUTPUT = './scripts/cbl-puzzles-advanced.json';

async function main() {
  const ffish = await ffishModule({ wasmBinary });

  let allPuzzles = [];
  try {
    allPuzzles = JSON.parse(readFileSync(OUTPUT, 'utf8'));
    console.log(`Loaded ${allPuzzles.length} existing puzzles`);
  } catch {}

  // Track existing (title, rec) pairs to avoid duplicates on resume
  const existingKeys = new Set(allPuzzles.map(p => p._cblKey));

  for (const { file, title } of CBL_FILES) {
    let data;
    try { data = readFileSync(file); } catch (e) { console.error(`Skip ${file}: ${e.message}`); continue; }

    console.log(`\n=== ${title} ===`);
    let solved = 0, skipped = 0;

    for (let rec = 0; rec < NUM_RECORDS; rec++) {
      const cblKey = `${title}_${rec}`;
      if (existingKeys.has(cblKey)) continue; // already done

      const base    = FIRST_OFFSET + rec * 0x1000 + BOARD_OFFSET;
      const board90 = Array.from(data.slice(base, base + 90));
      if (!board90.some(b => b === 0x15) || !board90.some(b => b === 0x25)) continue;

      const ffishFen = boardToFfishFen(board90);
      const appFen   = ffishFenToApp(ffishFen);

      const pv = solvePosition(ffish, ffishFen);
      if (!pv) {
        skipped++;
        continue;
      }

      const appMoves = pv.map(ffishMoveToApp);
      const steps    = appMoves.length;
      if (rec < 5 || steps > 3) {
        console.log(`  rec${rec}: mate-in-${Math.ceil(steps/2)} → ${appMoves.join(' ')}`);
      }

      const puzzle = {
        id: randomBytes(8).toString('hex'),
        _cblKey: cblKey,   // internal: used for resume-safe dedup, not written to Firestore
        level: Math.min(Math.ceil(steps / 2), 10),
        title: `${title} ${rec + 1}`,
        description: `${title}殺法練習`,
        initialFen: appFen,
        moves: appMoves,
        totalSteps: steps,
        createdBy: 'cbl-import',
        isPublished: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      allPuzzles.push(puzzle);
      existingKeys.add(cblKey);
      solved++;

      // Save after each find
      writeFileSync(OUTPUT, JSON.stringify(allPuzzles, null, 2));
    }

    console.log(`  → ${solved} solved, ${skipped} skipped`);
  }

  console.log(`\nTotal: ${allPuzzles.length} puzzles → ${OUTPUT}`);
}

main().catch(console.error);
