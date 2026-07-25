import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemberAccessStore } from "./memberAccessStore.ts";

test("member invite redemption, quota, refund and revocation persist safely", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-members-"));

  try {
    const store = new MemberAccessStore(dataDir, 2, 1);
    const created = store.createInvite({
      memberName: "  Test Member  ",
      dailyLimit: 2,
      expiresInHours: 2,
    });

    assert.match(created.code, /^BS-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}$/);
    assert.equal(created.invite.memberName, "Test Member");
    assert.equal("codeHash" in created.invite, false);

    const redeemed = store.redeemInvite(created.code.toLowerCase());
    assert.match(redeemed.sessionToken, /^bst_/);
    assert.deepEqual(
      {
        memberName: redeemed.session.memberName,
        dailyLimit: redeemed.session.dailyLimit,
        usedToday: redeemed.session.usedToday,
        remainingToday: redeemed.session.remainingToday,
      },
      {
        memberName: "Test Member",
        dailyLimit: 2,
        usedToday: 0,
        remainingToday: 2,
      },
    );
    assert.throws(() => store.redeemInvite(created.code), /无效、已使用或已过期/);
    assert.equal(store.resolveSession("wrong-token"), undefined);
    assert.equal(store.resolveSession(redeemed.sessionToken)?.id, redeemed.session.id);

    assert.deepEqual(store.consumeQuota(redeemed.session.id, 1)?.allowed, true);
    const denied = store.consumeQuota(redeemed.session.id, 2);
    assert.equal(denied?.allowed, false);
    assert.equal(denied?.quota.remainingToday, 1);

    store.refundQuota(redeemed.session.id, 1);
    assert.equal(store.resolveSession(redeemed.sessionToken)?.remainingToday, 2);
    assert.equal(store.revokeCurrentSession(redeemed.session.id), true);
    assert.equal(store.revokeCurrentSession(redeemed.session.id), false);
    assert.equal(store.resolveSession(redeemed.sessionToken), undefined);

    const persisted = JSON.parse(
      fs.readFileSync(path.join(dataDir, "member-access.json"), "utf8"),
    ) as {
      invites: Array<Record<string, unknown>>;
      sessions: Array<Record<string, unknown>>;
    };
    assert.equal("codeHash" in persisted.invites[0], true);
    assert.equal("tokenHash" in persisted.sessions[0], true);
    assert.equal(JSON.stringify(persisted).includes(created.code), false);
    assert.equal(JSON.stringify(persisted).includes(redeemed.sessionToken), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("invite validation and configured bounds are deterministic", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-members-"));

  try {
    const store = new MemberAccessStore(dataDir, 3);

    assert.throws(() => store.createInvite({ memberName: " " }), /请填写成员名称/);
    assert.throws(() => store.redeemInvite(""), /请输入邀请码/);
    assert.throws(() => store.redeemInvite("BS-NOT-VALID"), /无效、已使用或已过期/);

    const low = store.createInvite({ memberName: "low", dailyLimit: -10 });
    const high = store.createInvite({ memberName: "high", dailyLimit: 1_000 });
    assert.equal(low.invite.dailyLimit, 1);
    assert.equal(high.invite.dailyLimit, 100);
    assert.equal(store.revokeInvite(low.invite.id), true);
    assert.equal(store.revokeInvite(low.invite.id), false);
    assert.throws(() => store.redeemInvite(low.code), /无效、已使用或已过期/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
