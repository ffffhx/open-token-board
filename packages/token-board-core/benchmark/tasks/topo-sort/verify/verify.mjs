import { topoSort } from "../src/topo.mjs";

// Helper: check that the result is a valid topological order for the given edges,
// contains exactly the expected nodes, and matches the expected string (for determinism).
function check(nodes, edges, expected, label) {
  let result;
  try {
    result = topoSort(nodes, edges);
  } catch (e) {
    console.error(`FAIL [${label}]: topoSort threw an exception: ${e.message}`);
    process.exit(1);
  }

  if (expected === null) {
    // Expect cycle detection => null
    if (result !== null) {
      console.error(`FAIL [${label}]: expected null (cycle), got ${JSON.stringify(result)}`);
      process.exit(1);
    }
    return;
  }

  // Expect a valid ordering
  if (!Array.isArray(result)) {
    console.error(`FAIL [${label}]: expected array, got ${JSON.stringify(result)}`);
    process.exit(1);
  }

  // Must contain all nodes exactly once
  if (result.length !== nodes.length) {
    console.error(`FAIL [${label}]: result length ${result.length} !== nodes length ${nodes.length}: ${JSON.stringify(result)}`);
    process.exit(1);
  }
  const resultSet = new Set(result);
  for (const n of nodes) {
    if (!resultSet.has(n)) {
      console.error(`FAIL [${label}]: node "${n}" missing from result ${JSON.stringify(result)}`);
      process.exit(1);
    }
  }

  // Must satisfy all edge constraints: from appears before to
  const pos = new Map(result.map((n, i) => [n, i]));
  for (const [from, to] of edges) {
    if (pos.get(from) >= pos.get(to)) {
      console.error(`FAIL [${label}]: edge [${from}->${to}] violated in result ${JSON.stringify(result)}`);
      process.exit(1);
    }
  }

  // Must match expected deterministic order (ascending ID tie-break)
  if (JSON.stringify(result) !== JSON.stringify(expected)) {
    console.error(`FAIL [${label}]: expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
    process.exit(1);
  }
}

// Case 1: Simple linear chain a->b->c
check(
  ["a", "b", "c"],
  [["a", "b"], ["b", "c"]],
  ["a", "b", "c"],
  "linear chain a->b->c"
);

// Case 2: Diamond with tie-break — a->{b,c}->d; b and c both ready after a; b < c lexically
check(
  ["a", "b", "c", "d"],
  [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]],
  ["a", "b", "c", "d"],
  "diamond a->b,c->d with tie-break"
);

// Case 3: No edges — all nodes independent, sorted by ID
check(
  ["z", "a", "m"],
  [],
  ["a", "m", "z"],
  "no edges, lexicographic order"
);

// Case 4: Cycle a->b->c->a => null
check(
  ["a", "b", "c"],
  [["a", "b"], ["b", "c"], ["c", "a"]],
  null,
  "simple 3-cycle"
);

// Case 5: Self-loop b->b => null
check(
  ["a", "b"],
  [["a", "b"], ["b", "b"]],
  null,
  "self-loop"
);

// Case 6: Two independent chains; tie-break selects across chains
// chain1: p->q; chain2: r->s; p<r, so order: p, q, r, s? No —
// Initially p and r are both in-degree 0. p < r, so p goes first.
// After p: q becomes in-degree 0. Queue: [q, r]. q < r, so q goes next.
// After q: no new. Queue: [r]. r goes. Then s.
check(
  ["p", "q", "r", "s"],
  [["p", "q"], ["r", "s"]],
  ["p", "q", "r", "s"],
  "two independent chains with tie-break"
);

// Case 7: Larger DAG with multiple sources and levels
// Nodes: 1,2,3,4,5,6 (as strings)
// Edges: 1->3, 1->4, 2->4, 2->5, 3->6, 4->6, 5->6
// Sources: 1, 2 (both in-degree 0); tie-break => 1 first
// After 1: 3 in-degree 0, 4 in-degree 1; queue=[2,3]
// Take 2: 4 in-degree 0, 5 in-degree 0; queue=[3,4,5]
// Take 3: 6 in-degree 2; queue=[4,5]
// Take 4: 6 in-degree 1; queue=[5]
// Take 5: 6 in-degree 0; queue=[6]
// Take 6 => [1,2,3,4,5,6]
check(
  ["1", "2", "3", "4", "5", "6"],
  [["1", "3"], ["1", "4"], ["2", "4"], ["2", "5"], ["3", "6"], ["4", "6"], ["5", "6"]],
  ["1", "2", "3", "4", "5", "6"],
  "larger DAG 6-node"
);

// Case 8: Cycle only in a sub-graph; other nodes exist but cycle makes it null
check(
  ["a", "b", "c", "x"],
  [["a", "b"], ["b", "c"], ["c", "b"], ["a", "x"]],
  null,
  "partial cycle b<->c"
);

console.log("OK topo-sort");
process.exit(0);
