import assert from "node:assert/strict";
import { test } from "node:test";

test("PostgreSQL CI cannot silently skip database integration tests", () => {
  if (process.env.TOKEN_BOARD_REQUIRE_POSTGRES_TESTS === "true") {
    assert.ok(process.env.TOKEN_BOARD_TEST_DATABASE_URL, "TOKEN_BOARD_TEST_DATABASE_URL is required in the PostgreSQL CI job");
  }
});
