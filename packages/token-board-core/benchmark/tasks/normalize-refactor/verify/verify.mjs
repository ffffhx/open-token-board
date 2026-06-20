import {
  normalizeUser,
  saveUser,
  importUsers,
  updateUser,
  sanitizeUser,
} from "../src/user.mjs";

let failed = false;
function assert(label, got, expected) {
  const g = JSON.stringify(got);
  const e = JSON.stringify(expected);
  if (g !== e) {
    console.error(`FAIL ${label}: got ${g}, expected ${e}`);
    failed = true;
  }
}

// ── normalizeUser 基础功能 ────────────────────────────────────────────────
// name: trim + toLowerCase + fallback to "anonymous"
assert(
  "normalizeUser name trim+lower",
  normalizeUser({ name: "  Alice ", email: "x@x.com", role: "admin", score: 50 }),
  { name: "alice", email: "x@x.com", role: "admin", score: 50 }
);
assert(
  "normalizeUser name empty => anonymous",
  normalizeUser({ name: "   ", email: "a@b.com", role: "viewer", score: 0 }),
  { name: "anonymous", email: "a@b.com", role: "viewer", score: 0 }
);

// email: trim + toLowerCase
assert(
  "normalizeUser email trim+lower",
  normalizeUser({ name: "bob", email: "  BOB@Example.COM  ", role: "editor", score: 10 }),
  { name: "bob", email: "bob@example.com", role: "editor", score: 10 }
);

// role: invalid => "viewer"
assert(
  "normalizeUser invalid role => viewer",
  normalizeUser({ name: "carol", email: "c@c.com", role: "superuser", score: 20 }),
  { name: "carol", email: "c@c.com", role: "viewer", score: 20 }
);

// score: Math.floor (not round), clamp [0,100]
assert(
  "normalizeUser score floor",
  normalizeUser({ name: "dave", email: "d@d.com", role: "viewer", score: 7.9 }),
  { name: "dave", email: "d@d.com", role: "viewer", score: 7 }
);
assert(
  "normalizeUser score clamp low",
  normalizeUser({ name: "eve", email: "e@e.com", role: "viewer", score: -5 }),
  { name: "eve", email: "e@e.com", role: "viewer", score: 0 }
);
assert(
  "normalizeUser score clamp high",
  normalizeUser({ name: "frank", email: "f@f.com", role: "admin", score: 150 }),
  { name: "frank", email: "f@f.com", role: "admin", score: 100 }
);

// ── saveUser: 必须修复 role 默认值 ────────────────────────────────────────
assert(
  "saveUser invalid role => viewer",
  saveUser({ name: "g", email: "g@g.com", role: "god", score: 30 }),
  { name: "g", email: "g@g.com", role: "viewer", score: 30 }
);
assert(
  "saveUser name lower",
  saveUser({ name: "GRACE", email: "gr@gr.com", role: "editor", score: 0 }),
  { name: "grace", email: "gr@gr.com", role: "editor", score: 0 }
);

// ── importUsers: 必须用 Math.floor 而非 Math.round ────────────────────────
assert(
  "importUsers score floor not round",
  importUsers([{ name: "hank", email: "h@h.com", role: "viewer", score: 4.6 }]),
  [{ name: "hank", email: "h@h.com", role: "viewer", score: 4 }]
);
assert(
  "importUsers invalid role => viewer",
  importUsers([{ name: "ivan", email: "i@i.com", role: "root", score: 1 }]),
  [{ name: "ivan", email: "i@i.com", role: "viewer", score: 1 }]
);

// ── updateUser: 必须用 Math.floor ─────────────────────────────────────────
assert(
  "updateUser score floor",
  updateUser(
    { name: "judy", email: "j@j.com", role: "editor", score: 5 },
    { score: 9.8 }
  ),
  { name: "judy", email: "j@j.com", role: "editor", score: 9 }
);
assert(
  "updateUser patch role invalid => viewer",
  updateUser(
    { name: "kate", email: "k@k.com", role: "admin", score: 50 },
    { role: "wizard" }
  ),
  { name: "kate", email: "k@k.com", role: "viewer", score: 50 }
);

// ── sanitizeUser: 必须 toLowerCase ────────────────────────────────────────
assert(
  "sanitizeUser name toLowerCase",
  sanitizeUser({ name: "  Leo  ", email: "l@l.com", role: "viewer", score: 20 }),
  { name: "leo", email: "l@l.com", role: "viewer", score: 20 }
);

if (failed) process.exit(1);
console.log("OK normalize-refactor");
process.exit(0);
