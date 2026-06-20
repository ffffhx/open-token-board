import { getPageItems, pageCount } from "../src/pagination.mjs";

function assert(label, got, expected) {
  const g = JSON.stringify(got);
  const e = JSON.stringify(expected);
  if (g !== e) {
    console.error(`FAIL ${label}: got ${g}, expected ${e}`);
    process.exit(1);
  }
}

// --- getPageItems tests ---
const items5 = [1, 2, 3, 4, 5];

// page 1, pageSize 2 => [1, 2]
assert("getPageItems page1 size2", getPageItems(items5, 1, 2), [1, 2]);

// page 2, pageSize 2 => [3, 4]
assert("getPageItems page2 size2", getPageItems(items5, 2, 2), [3, 4]);

// page 3 (last, partial) => [5]
assert("getPageItems page3 size2 partial", getPageItems(items5, 3, 2), [5]);

// page 4 (out of range) => []
assert("getPageItems page4 size2 empty", getPageItems(items5, 4, 2), []);

// page 1, pageSize 5 (exact fit) => [1,2,3,4,5]
assert("getPageItems page1 sizeExact", getPageItems(items5, 1, 5), [1, 2, 3, 4, 5]);

// page 1, pageSize 10 (larger than array) => [1,2,3,4,5]
assert("getPageItems page1 sizeLarge", getPageItems(items5, 1, 10), [1, 2, 3, 4, 5]);

// --- pageCount tests ---

// 5 items, 2 per page => 3
assert("pageCount 5/2", pageCount(5, 2), 3);

// 4 items, 2 per page => 2 (exact)
assert("pageCount 4/2", pageCount(4, 2), 2);

// 0 items => 0
assert("pageCount 0", pageCount(0, 10), 0);

// 1 item, 10 per page => 1
assert("pageCount 1/10", pageCount(1, 10), 1);

// 10 items, 3 per page => 4
assert("pageCount 10/3", pageCount(10, 3), 4);

// 9 items, 3 per page => 3 (exact)
assert("pageCount 9/3", pageCount(9, 3), 3);

console.log("OK pagination-range");
process.exit(0);
