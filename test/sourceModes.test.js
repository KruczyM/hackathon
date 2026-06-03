import assert from "node:assert/strict";
import test from "node:test";
import { sourceProfileFor } from "../server/agents/prhSourceAgent.js";

test("new-changes mode keeps recent registration and notice profile", () => {
  const profile = sourceProfileFor({ marketMode: "new-changes", companyForm: "ANY" });

  assert.equal(profile.marketMode, "new-changes");
  assert.deepEqual(profile.companyForms, [undefined]);
  assert.equal(profile.companyDateFilter, true);
  assert.equal(profile.noticeSearch, true);
});

test("established mode searches existing limited companies before XBRL size filtering", () => {
  const profile = sourceProfileFor({ marketMode: "established", companyForm: "ANY" });

  assert.equal(profile.marketMode, "established");
  assert.deepEqual(profile.companyForms, ["OY", "OYJ"]);
  assert.equal(profile.companyDateFilter, false);
  assert.equal(profile.noticeSearch, true);
});

test("size segment modes search existing limited companies before employee segment filtering", () => {
  for (const marketMode of ["mid-market", "large-opportunities", "enterprise-watch"]) {
    const profile = sourceProfileFor({ marketMode, companyForm: "ANY" });

    assert.equal(profile.marketMode, marketMode);
    assert.deepEqual(profile.companyForms, ["OY", "OYJ"]);
    assert.equal(profile.companyDateFilter, false);
    assert.equal(profile.noticeSearch, true);
  }
});

test("listed-growth mode searches only public limited companies without notice scan", () => {
  const profile = sourceProfileFor({ marketMode: "listed-growth", companyForm: "ANY" });

  assert.equal(profile.marketMode, "listed-growth");
  assert.deepEqual(profile.companyForms, ["OYJ"]);
  assert.equal(profile.companyDateFilter, false);
  assert.equal(profile.noticeSearch, false);
});
