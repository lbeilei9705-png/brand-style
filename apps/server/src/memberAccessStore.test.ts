import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemberAccessStore } from "./memberAccessStore.ts";

test("member invite redemption, quota, refund and revocation persist safely", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-members-"));

  try {
    const store = new MemberAccessStore(dataDir, 2);
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
    assert.equal("expiresAt" in redeemed.session, false);

    const accessFilePath = path.join(dataDir, "member-access.json");
    assert.deepEqual(store.consumeQuota(redeemed.session.id, 1)?.allowed, true);
    const denied = store.consumeQuota(redeemed.session.id, 2);
    assert.equal(denied?.allowed, false);
    assert.equal(denied?.quota.remainingToday, 1);

    store.refundQuota(redeemed.session.id, 1);
    assert.equal(store.resolveSession(redeemed.sessionToken)?.remainingToday, 2);
    assert.equal(store.revokeSession(redeemed.session.id), true);
    assert.equal(store.revokeSession(redeemed.session.id), false);
    assert.equal(store.resolveSession(redeemed.sessionToken), undefined);

    const persisted = JSON.parse(
      fs.readFileSync(accessFilePath, "utf8"),
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

test("legacy session expiry migrates without reviving expired access", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-members-"));

  try {
    const store = new MemberAccessStore(dataDir, 2);
    const expired = store.redeemInvite(store.createInvite({ memberName: "expired" }).code);
    const active = store.redeemInvite(store.createInvite({ memberName: "active" }).code);
    const accessFilePath = path.join(dataDir, "member-access.json");
    const legacyData = JSON.parse(fs.readFileSync(accessFilePath, "utf8")) as {
      sessions: Array<Record<string, unknown>>;
    };
    legacyData.sessions[0].expiresAt = "2000-01-01T00:00:00.000Z";
    legacyData.sessions[1].expiresAt = "2999-01-01T00:00:00.000Z";
    fs.writeFileSync(accessFilePath, `${JSON.stringify(legacyData, null, 2)}\n`);

    assert.equal(store.resolveSession(expired.sessionToken), undefined);
    assert.equal(store.resolveSession(active.sessionToken)?.id, active.session.id);

    const migrated = JSON.parse(fs.readFileSync(accessFilePath, "utf8")) as {
      sessions: Array<Record<string, unknown>>;
    };
    assert.equal("expiresAt" in migrated.sessions[0], false);
    assert.equal("expiresAt" in migrated.sessions[1], false);
    assert.equal(migrated.sessions[0].revokedAt, "2000-01-01T00:00:00.000Z");
    assert.equal("revokedAt" in migrated.sessions[1], false);
    assert.equal(fs.existsSync(`${accessFilePath}.pre-permanent-sessions`), true);

    assert.equal(store.revokeMember(active.session.memberId), true);
    assert.equal(store.resolveSession(active.sessionToken), undefined);
    assert.equal(store.consumeQuota(active.session.id, 1), undefined);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("member relogin preserves identity and quota while revoking old sessions", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-members-"));

  try {
    const store = new MemberAccessStore(dataDir, 3);
    const initial = store.redeemInvite(store.createInvite({
      memberName: "Returning Member",
      dailyLimit: 3,
    }).code);
    assert.equal(store.consumeQuota(initial.session.id, 2)?.allowed, true);

    const reloginInvite = store.createMemberLoginInvite(initial.session.memberId);
    const replacement = store.redeemInvite(reloginInvite.code);

    assert.equal(replacement.session.memberId, initial.session.memberId);
    assert.equal(replacement.session.usedToday, 2);
    assert.equal(replacement.session.remainingToday, 1);
    assert.equal(store.resolveSession(initial.sessionToken), undefined);
    assert.equal(store.resolveSession(replacement.sessionToken)?.id, replacement.session.id);
    assert.equal(store.listForAdmin().members.length, 1);
    assert.throws(() => store.redeemInvite(reloginInvite.code), /无效、已使用或已过期/);

    store.refundQuota(initial.session.id, 1);
    assert.equal(store.resolveSession(replacement.sessionToken)?.usedToday, 1);
    const pendingInvite = store.createMemberLoginInvite(initial.session.memberId);
    store.revokeMember(initial.session.memberId);
    const revokedInvite = store.listForAdmin().invites.find((item) => item.id === pendingInvite.invite.id);
    assert.equal(revokedInvite?.status, "revoked");
    assert.throws(
      () => store.createMemberLoginInvite(initial.session.memberId),
      /成员不存在或已撤销/,
    );
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
