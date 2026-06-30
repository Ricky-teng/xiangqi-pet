/**
 * convert-cbl.mjs  — CBL → app PuzzleDoc JSON
 *
 * CBL encoding (symmetric):
 *   Red:   0x11=R 0x12=N 0x13=B 0x14=A 0x15=K 0x16=C 0x17=P
 *   Black: 0x21=r 0x22=n 0x23=b 0x24=a 0x25=k 0x26=c 0x27=p
 * Board at FIRST_OFFSET + rec*0x1000 + 0x848 (90 bytes, row0=black home).
 *
 * FEN/moves use ffish notation (N/B=horse/elephant).
 * App needs H/E notation and rows 0–9 with row0=black home.
 * ffish move notation: rank 1-10 with rank1=red home.
 * App move notation:   row  0-9  with row9=red home.
 * Conversion: app_row = 10 - ffish_rank  (bidirectional)
 */

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { default: ffishModule } = require('../node_modules/ffish-es6/ffish.js');
const wasmBinary = readFileSync('./node_modules/ffish-es6/ffish.wasm');

const NUM_RECORDS  = 113;
const FIRST_OFFSET = 0x18e40;
const BOARD_OFFSET = 0x848;
const MAX_DEPTH    = 7;    // ply (odd = red makes last move); covers mate-in-4

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

// ffish rank 1-10 (rank1=red home) → app row 0-9 (row9=red home)
function ffishMoveToApp(mv) {
  const m = mv.match(/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/);
  if (!m) throw new Error('bad ffish move: ' + mv);
  return `${m[1]}${10 - Number(m[2])}${m[3]}${10 - Number(m[4])}`;
}

// ffish FEN board part → app FEN (N→H, B→E, n→h, b→e)
function ffishFenToApp(fen) {
  return fen.split(' ')[0].replace(/[NnBb]/g, c => ({ N:'H', n:'h', B:'E', b:'e' }[c]));
}

// ── Mate finder (iterative deepening) ───────────────────────────
// Returns main-line move list in ffish notation, or null.
function findMate(board, depth) {
  if (depth === 0) return null;
  const isRedTurn = board.turn();
  const movesStr  = board.legalMoves();
  const moves     = movesStr ? movesStr.split(' ').filter(Boolean) : [];
  if (moves.length === 0) return isRedTurn ? null : []; // black has no moves = mate

  if (isRedTurn) {
    // Put check-giving moves first (minor heuristic)
    const sorted = [];
    for (const mv of moves) {
      board.push(mv);
      const gives_check = board.isCheck();
      board.pop();
      if (gives_check) sorted.unshift(mv); else sorted.push(mv);
    }
    for (const mv of sorted) {
      board.push(mv);
      if (board.isGameOver() && board.result() === '1-0') {
        board.pop();
        return [mv];
      }
      const cont = findMate(board, depth - 1);
      board.pop();
      if (cont !== null) return [mv, ...cont];
    }
    return null;
  } else {
    // All black responses must lead to red winning
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

// ── Main ─────────────────────────────────────────────────────────
const CBL_FILES = [
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/鐵門栓.CBL', title: '鐵門栓' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/長短車.CBL', title: '長短車' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/雙炮將.CBL', title: '雙炮將' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/對面笑.CBL', title: '對面笑' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/悶宮殺.CBL', title: '悶宮殺' },
];

async function main() {
  const ffish = await ffishModule({ wasmBinary });
  // Load existing partial results to append to
  let allPuzzles = [];
  try { allPuzzles = JSON.parse(readFileSync('./scripts/cbl-puzzles.json', 'utf8')); console.log(`Loaded ${allPuzzles.length} existing puzzles`); } catch {}

  for (const { file, title } of CBL_FILES) {
    let data;
    try { data = readFileSync(file); } catch (e) { console.error(`Skip ${file}: ${e.message}`); continue; }

    console.log(`\n=== ${title} ===`);
    let solved = 0, skipped = 0;

    for (let rec = 0; rec < NUM_RECORDS; rec++) {
      const base    = FIRST_OFFSET + rec * 0x1000 + BOARD_OFFSET;
      const board90 = Array.from(data.slice(base, base + 90));
      if (!board90.some(b => b === 0x15) || !board90.some(b => b === 0x25)) continue;

      const ffishFen = boardToFfishFen(board90);
      const appFen   = ffishFenToApp(ffishFen);

      const pv = solvePosition(ffish, ffishFen);
      if (!pv) {
        console.log(`  rec${rec}: no forced mate in ${MAX_DEPTH} ply — skipped`);
        skipped++;
        continue;
      }

      const appMoves = pv.map(ffishMoveToApp);
      const steps    = appMoves.length;
      if (rec < 5 || steps > 3) {
        console.log(`  rec${rec}: mate-in-${Math.ceil(steps/2)} → ${appMoves.join(' ')}`);
      }

      allPuzzles.push({
        id: `${title}_${rec}`,
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
      });
      solved++;
    }

    console.log(`  → ${solved} solved, ${skipped} skipped`);
    // Save partial results after each file
    writeFileSync('./scripts/cbl-puzzles.json', JSON.stringify(allPuzzles, null, 2));
  }

  const out = './scripts/cbl-puzzles.json';
  writeFileSync(out, JSON.stringify(allPuzzles, null, 2));
  console.log(`\nTotal: ${allPuzzles.length} puzzles → ${out}`);
}

main().catch(console.error);
