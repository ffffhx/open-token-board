import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const answerPath = resolve(__dirname, '../ANSWER.txt');

let raw;
try {
  raw = readFileSync(answerPath, 'utf8');
} catch {
  console.error('FAIL: 找不到 ANSWER.txt，请将最终状态名写入该文件');
  process.exit(1);
}

const answer = raw.trim();

// The correct final state for the event sequence described in the prompt:
// Starting: IDLE, context { balance: 0, price: 0 }
// 1. INSERT { amount: 100 }  -> balance=100, IDLE->SELECTING
// 2. SELECT { price: 150 }   -> price=150, balance<price -> SELECTING
// 3. INSERT { amount: 60 }   -> balance=160, SELECTING->SELECTING
// 4. SELECT { price: 150 }   -> price=150, balance>=price -> PAYING
// 5. TIMEOUT                 -> PAYING->REFUNDING
// 6. DONE                    -> REFUNDING->IDLE
// 7. SELECT { price: 80 }    -> price=80, balance=160>=80 -> PAYING
// 8. CONFIRM                 -> PAYING->DISPENSING
const expected = 'DISPENSING';

if (answer !== expected) {
  console.error(`FAIL: 期望最终状态为 "${expected}"，实际得到 "${answer}"`);
  process.exit(1);
}

console.log(`OK: 最终状态 "${answer}" 正确`);
process.exit(0);
