/**
 * convert-cbl.mjs
 *
 * Converts CCBridge3 .CBL puzzle files into the app's PuzzleDoc format.
 *
 * CBL encoding (confirmed by position-frequency analysis):
 *   Red:   0x11=R 0x12=N 0x13=B 0x14=A 0x15=K 0x16=C 0x17=P
 *   Black: 0x21=r 0x22=n 0x23=b 0x24=a 0x25=k 0x26=c 0x27=p
 * Board: 90-byte array at FIRST_RECORD_OFFSET + rec*RECORD_SIZE + BOARD_OFFSET
 *        row 0 = black home (rank 10), row 9 = red home (rank 1)
 *
 * FEN produced here uses ffish notation (N=horse, B=elephant).
 * We convert to app notation (H=horse, E=elephant) before output.
 *
 * Solutions are found with ffish (up to MAX_DEPTH ply).
 */

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const { default: ffishModule } = require('../node_modules/ffish-es6/ffish.js');
const wasmBinary = readFileSync('./node_modules/ffish-es6/ffish.wasm');

// ── CBL constants ───────────────────────────────────────────────
const NUM_RECORDS     = 113;
const RECORD_SIZE     = 0x1000;
const FIRST_OFFSET    = 0x18e40;
const BOARD_OFFSET    = 0x848;

const RED_MAP  = { 0x11:'R', 0x12:'N', 0x13:'B', 0x14:'A', 0x15:'K', 0x16:'C', 0x17:'P' };
const BLK_MAP  = { 0x21:'r', 0x22:'n', 0x23:'b', 0x24:'a', 0x25:'k', 0x26:'c', 0x27:'p' };

// ── Notation conversion ─────────────────────────────────────────
// ffish rank (1-10, 1=red home) ↔ app row (0-9, 9=red home)
// formula: app_row = 10 - ffish_rank  (bidirectional)
function ffishMoveToApp(ffishMove) {
  const m = ffishMove.match(/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/);
  if (!m) throw new Error('Cannot parse ffish move: ' + ffishMove);
  const [, ff, fr, tf, tr] = m;
  return `${ff}${10 - Number(fr)}${tf}${10 - Number(tr)}`;
}

// app FEN (H/E notation) → ffish FEN (N/B notation) + side
function appFenToFfish(appFen, side = 'w') {
  return appFen.replace(/[HhEe]/g, c => ({ H:'N', h:'n', E:'B', e:'b' }[c])) + ' ' + side;
}

// ffish FEN → app FEN (board part only, H/E notation)
function ffishFenToApp(ffishFen) {
  return ffishFen.split(' ')[0].replace(/[NnBb]/g, c => ({ N:'H', n:'h', B:'E', b:'e' }[c]));
}

// ── CBL → ffish FEN ─────────────────────────────────────────────
function boardToFfishFen(board90) {
  const rows = [];
  for (let row = 0; row < 10; row++) {
    let s = '', empty = 0;
    for (let col = 0; col < 9; col++) {
      const b = board90[row * 9 + col];
      const p = RED_MAP[b] || BLK_MAP[b] || null;
      if (p) { if (empty) { s += empty; empty = 0; } s += p; }
      else empty++;
    }
    if (empty) s += empty;
    rows.push(s);
  }
  return rows.join('/') + ' w - - 0 1';
}

// ── Mate finder (iterative deepening up to maxDepth ply) ─────────
// Returns the main-line move sequence in ffish notation, or null.
// At each RED ply we find ANY move that leads to forced mate.
// At each BLACK ply we pick the "hardest" defense (longest line), but
// since these are forced mates the black response is the only legal one
// or we record one representative response.
function findMate(ffish, board, depth) {
  if (depth === 0) return null;

  const isRedTurn = board.turn(); // true = red (the attacker)
  const legalStr = board.legalMoves();
  const moves = legalStr ? legalStr.split(' ').filter(Boolean) : [];

  if (moves.length === 0) {
    // No legal moves. If red is to move and can't, that's not what we want
    // (means red lost). Black having no moves = checkmate for red = success.
    return isRedTurn ? null : [];
  }

  if (isRedTurn) {
    // Try each red move; return first one that leads to forced mate
    for (const mv of moves) {
      board.push(mv);
      if (board.isGameOver()) {
        const res = board.result();
        board.pop();
        if (res === '1-0') return [mv]; // 1-move checkmate
      } else {
        const cont = findMate(ffish, board, depth - 1);
        board.pop();
        if (cont !== null) return [mv, ...cont];
      }
    }
    return null;
  } else {
    // Black is to move. For a forced mate, ALL black responses must lead
    // to red mating. We collect one representative line.
    let repLine = null;
    for (const mv of moves) {
      board.push(mv);
      const cont = findMate(ffish, board, depth - 1);
      board.pop();
      if (cont === null) return null; // black can escape
      if (repLine === null) repLine = [mv, ...cont];
    }
    return repLine ?? null;
  }
}

function solvePosition(ffish, ffishFen) {
  const MAX_DEPTH = 7; // odd depths (1,3,5,7 ply) = red makes last move
  for (let depth = 1; depth <= MAX_DEPTH; depth += 2) {
    const board = new ffish.Board('xiangqi', ffishFen);
    const result = findMate(ffish, board, depth);
    board.delete();
    if (result) return result;
  }
  return null;
}

// ── Main ────────────────────────────────────────────────────────
const CBL_FILES = [
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/馬後炮.CBL', title: '馬後炮', tag: '馬後炮' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/臥槽馬.CBL', title: '臥槽馬', tag: '臥槽馬' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/掛角馬.CBL', title: '掛角馬', tag: '掛角馬' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/釣魚馬.CBL', title: '釣魚馬', tag: '釣魚馬' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/鐵門栓.CBL', title: '鐵門栓', tag: '鐵門栓' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/長短車.CBL', title: '長短車', tag: '長短車' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/雙炮將.CBL', title: '雙炮將', tag: '雙炮將' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/對面笑.CBL', title: '對面笑', tag: '對面笑' },
  { file: 'C:/Users/small/OneDrive/桌面/1-基礎殺法-1/悶宮殺.CBL', title: '悶宮殺', tag: '悶宮殺' },
];

async function main() {
  const ffish = await ffishModule({ wasmBinary });
  const allPuzzles = [];

  for (const { file, title, tag } of CBL_FILES) {
    let data;
    try { data = readFileSync(file); }
    catch (e) { console.error(`Cannot read ${file}: ${e.message}`); continue; }

    console.log(`\n=== ${title} (${file}) ===`);
    let solved = 0, unsolved = 0;

    for (let rec = 0; rec < NUM_RECORDS; rec++) {
      const boardStart = FIRST_OFFSET + rec * RECORD_SIZE + BOARD_OFFSET;
      const board90 = Array.from(data.slice(boardStart, boardStart + 90));

      // Skip empty records (no kings)
      const hasRedKing   = board90.some(b => b === 0x15);
      const hasBlackKing = board90.some(b => b === 0x25);
      if (!hasRedKing || !hasBlackKing) continue;

      const ffishFen = boardToFfishFen(board90);
      const appFen   = ffishFenToApp(ffishFen);

      // Validate position
      let valid = false;
      try { const b = new ffish.Board('xiangqi', ffishFen); valid = true; b.delete(); }
      catch { valid = false; }
      if (!valid) { console.log(`  rec${rec}: invalid FEN, skipping`); continue; }

      // Find solution
      const solution = solvePosition(ffish, ffishFen);
      if (!solution) {
        console.log(`  rec${rec}: no mate found within 7 ply`);
        unsolved++;
        continue;
      }

      // Convert moves to app notation
      const appMoves = solution.map(ffishMoveToApp);
      const totalSteps = appMoves.length;

      allPuzzles.push({
        id: `${tag}_${rec}`,
        level: Math.min(Math.ceil(totalSteps / 2), 10),
        title: `${title} ${rec + 1}`,
        description: `${title}殺法練習`,
        initialFen: appFen,
        moves: appMoves,
        totalSteps,
        createdBy: 'cbl-import',
        isPublished: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      solved++;

      if (rec < 3) {
        console.log(`  rec${rec}: FEN=${appFen}  moves=${appMoves.join(',')}`);
      }
    }

    console.log(`  → ${solved} solved, ${unsolved} unsolved`);
  }

  const outPath = './scripts/cbl-puzzles.json';
  writeFileSync(outPath, JSON.stringify(allPuzzles, null, 2));
  console.log(`\nWrote ${allPuzzles.length} puzzles to ${outPath}`);
}

main().catch(console.error);
