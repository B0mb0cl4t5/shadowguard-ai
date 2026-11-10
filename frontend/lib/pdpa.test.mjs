import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluatePdpa } from "./pdpa.ts";

/** The s. 10 (Retention Principle) check for one retention answer. */
function sec10(retention) {
  const answers = retention === undefined ? {} : { retention };
  const check = evaluatePdpa({ answers, verification_status: "verified" }).find((c) => c.section === "s. 10");
  assert.ok(check, "every evaluation includes s. 10");
  return check;
}

test("s. 10 reads a saved analysis's retention, sent as '<n> days'", () => {
  // The demo vendors as the live API returns them.
  assert.equal(sec10("1095 days").status, "Violation"); // GradeSync Pro: 3 years
  assert.equal(sec10("720 days").status, "Violation"); // PromptPal
  assert.equal(sec10("366 days").status, "Violation");
  assert.equal(sec10("365 days").status, "Review");
  assert.equal(sec10("360 days").status, "Review"); // TranscribeFly
  assert.equal(sec10("180 days").status, "Review"); // GrammarGlow
  assert.equal(sec10("90 days").status, "Review"); // DeckGenie
  assert.equal(sec10("31 days").status, "Review");
  assert.equal(sec10("30 days").status, "Pass"); // CodeMuse
  assert.equal(sec10("7 days").status, "Pass");
});

test("s. 10 reads a dry run's or Gemini's retention, sent as a bare number", () => {
  assert.equal(sec10("1095").status, "Violation");
  assert.equal(sec10("90").status, "Review");
  assert.equal(sec10("30").status, "Pass");
});

test("s. 10 flags indefinite retention and asks for review when it is not stated", () => {
  assert.equal(sec10("indefinite").status, "Violation");
  assert.equal(sec10("unknown").status, "Review");
  assert.equal(sec10(undefined).status, "Review");
});

test("s. 10 never passes a retention answer it cannot read", () => {
  for (const value of ["", "about a year", ">365d", "31-365d", "3 years", "-5 days"]) {
    assert.equal(sec10(value).status, "Review", `${JSON.stringify(value)} must need a review`);
  }
});

test("s. 10 states the period it was given", () => {
  assert.match(sec10("1095 days").detail, /1095 days/);
  assert.match(sec10("90").detail, /90 days/);
  assert.match(sec10("7 days").detail, /within 7 days/);
  assert.doesNotMatch(sec10("indefinite").detail, /\d/);
});
