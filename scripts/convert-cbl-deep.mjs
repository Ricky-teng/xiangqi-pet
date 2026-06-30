/**
 * convert-cbl-deep.mjs — second pass with higher depth
 *
 * Loads existing cbl-puzzles.json, finds which rec numbers are missing
 * for each CBL file, then tries to solve them at MAX_DEPTH=13 (mate-in-7).
 * Starts iterating from depth 9 (depths 1-7 were already tried).
 * Appends any newly found solutions to the JSON.
 */

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { default: ffishModule } = require('../node_modules/ffish-es6/ffish.js');
const wasmBinary = readFileSync('./node_modules/ffish-es6/ffish.wasm');

const NUM_RECORDS  = 113;
const FIRST_OFFSET = 0x18e40;
const BOARD_OFFSET = 0x848;
const MIN_DEPTH    = 9;   // already tried 1,3,5,7 in first pass
const MAX_DEPTH    = 13;  // covers mate-in-7

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

function solveDeep(ffish, ffishFen) {
  for (let depth = MIN_DEPTH; depth <= MAX_DEPTH; depth += 2) {
    const board = new ffish.Board('xiangqi', ffishFen);
    const result = findMate(board, depth);
    board.delete();
    if (result) return result;
  }
  return null;
}

const ALL_CBL_FILES = [
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/馬後炮.CBL', title: '馬後炮' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/臥槽馬.CBL', title: '臥槽馬' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/掛角馬.CBL', title: '掛角馬' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/釣魚馬.CBL', title: '釣魚馬' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/鐵門栓.CBL', title: '鐵門栓' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/長短車.CBL', title: '長短車' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/雙炮將.CBL', title: '雙炮將' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/1-對面笑.CBL', title: '對面笑' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/悶宮殺.CBL', title: '悶宮殺' },
];

async function main() {
  const ffish = await ffishModule({ wasmBinary });

  const allPuzzles = JSON.parse(readFileSync('./scripts/cbl-puzzles.json', 'utf8'));
  console.log(`Loaded ${allPuzzles.length} existing puzzles`);

  // Build a set of already-solved IDs (1-indexed: title_rec+1)
  const existingIds = new Set(allPuzzles.map(p => p.id));

  let totalNew = 0;

  for (const { file, title } of ALL_CBL_FILES) {
    let data;
    try { data = readFileSync(file); } catch (e) { console.error(`Skip ${file}: ${e.message}`); continue; }

    // Find which rec numbers are missing
    const missing = [];
    for (let rec = 0; rec < NUM_RECORDS; rec++) {
      const id = `${title}_${rec + 1}`;
      if (!existingIds.has(id)) {
        const base = FIRST_OFFSET + rec * 0x1000 + BOARD_OFFSET;
        const board90 = Array.from(data.slice(base, base + 90));
        if (board90.some(b => b === 0x15) && board90.some(b => b === 0x25)) {
          missing.push(rec);
        }
      }
    }

    if (missing.length === 0) { console.log(`${title}: all solved, skip`); continue; }
    console.log(`\n=== ${title} — ${missing.length} missing positions ===`);

    let newFound = 0;
    for (const rec of missing) {
      const base    = FIRST_OFFSET + rec * 0x1000 + BOARD_OFFSET;
      const board90 = Array.from(data.slice(base, base + 90));
      const ffishFen = boardToFfishFen(board90);
      const appFen   = ffishFenToApp(ffishFen);

      console.log(`  rec${rec} (id ${title}_${rec + 1}): searching depth ${MIN_DEPTH}-${MAX_DEPTH}…`);
      const pv = solveDeep(ffish, ffishFen);
      if (!pv) {
        console.log(`    → no mate in ${MAX_DEPTH} ply`);
        continue;
      }

      const appMoves = pv.map(ffishMoveToApp);
      const steps    = appMoves.length;
      console.log(`    → mate-in-${Math.ceil(steps / 2)}: ${appMoves.join(' ')}`);

      const puzzle = {
        id: `${title}_${rec + 1}`,
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
      existingIds.add(puzzle.id);
      newFound++;
      totalNew++;
    }

    console.log(`  → ${newFound} new puzzles found`);
    writeFileSync('./scripts/cbl-puzzles.json', JSON.stringify(allPuzzles, null, 2));
  }

  console.log(`\nDone. ${totalNew} new puzzles added. Total: ${allPuzzles.length} → ./scripts/cbl-puzzles.json`);
}

main().catch(console.error);
