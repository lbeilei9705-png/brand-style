import crypto from "crypto";
import fs from "fs";
import path from "path";

interface MemberInvite {
  id: string;
  memberId?: string;
  memberName: string;
  codeHash: string;
  dailyLimit: number;
  createdAt: string;
  expiresAt: string;
  redeemedAt?: string;
  revokedAt?: string;
}

interface Member {
  id: string;
  name: string;
  enabled: boolean;
  dailyLimit: number;
  createdAt: string;
  updatedAt: string;
}

interface MemberSession {
  id: string;
  memberId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt?: string;
  lastSeenAt: string;
  revokedAt?: string;
  usageByDate: Record<string, number>;
}

interface MemberAccessData {
  invites: MemberInvite[];
  members: Member[];
  sessions: MemberSession[];
}

export interface MemberSessionInfo {
  id: string;
  memberId: string;
  memberName: string;
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
  lastSeenAt: string;
}

export interface MemberQuota {
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
  resetsAt: string;
}

const EMPTY_DATA: MemberAccessData = {
  invites: [],
  members: [],
  sessions: [],
};

function now(): string {
  return new Date().toISOString();
}

function hashSecret(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getUsageDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getNextResetAt(): string {
  const reset = new Date();
  reset.setUTCHours(24, 0, 0, 0);
  return reset.toISOString();
}

function createInviteCode(): string {
  const value = crypto.randomBytes(10).toString("hex").toUpperCase();
  return `BS-${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15)}`;
}

function normalizeInviteCode(value: string): string {
  return value.trim().toUpperCase();
}

export class MemberAccessStore {
  private readonly filePath: string;
  private readonly defaultDailyLimit: number;

  constructor(dataDir: string, defaultDailyLimit = 20) {
    this.filePath = path.join(dataDir, "member-access.json");
    this.defaultDailyLimit = Math.max(1, defaultDailyLimit);
    fs.mkdirSync(dataDir, { recursive: true });
  }

  private read(): MemberAccessData {
    if (!fs.existsSync(this.filePath)) {
      this.write(EMPTY_DATA);
      return structuredClone(EMPTY_DATA);
    }

    const data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as MemberAccessData;
    let migrated = false;

    for (const session of data.sessions) {
      if (!session.expiresAt) {
        continue;
      }

      const expiresAt = Date.parse(session.expiresAt);
      if (!session.revokedAt && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        session.revokedAt = session.expiresAt;
      }
      delete session.expiresAt;
      migrated = true;
    }

    if (migrated) {
      const backupPath = `${this.filePath}.pre-permanent-sessions`;
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(this.filePath, backupPath);
        fs.chmodSync(backupPath, 0o600);
      }
      this.write(data);
    }

    return data;
  }

  private write(data: MemberAccessData): void {
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, this.filePath);
  }

  createInvite(input: {
    memberName?: string;
    dailyLimit?: number;
    expiresInHours?: number;
  }): { invite: Omit<MemberInvite, "codeHash">; code: string } {
    const memberName = String(input.memberName || "").trim();

    if (!memberName) {
      throw new Error("请填写成员名称。");
    }

    const data = this.read();
    const code = createInviteCode();
    const createdAt = now();
    const invite: MemberInvite = {
      id: `invite_${crypto.randomUUID()}`,
      memberName,
      codeHash: hashSecret(code),
      dailyLimit: Math.max(1, Math.min(100, Number(input.dailyLimit) || this.defaultDailyLimit)),
      createdAt,
      expiresAt: new Date(
        Date.now() + Math.max(1, Math.min(168, Number(input.expiresInHours) || 24)) * 60 * 60 * 1_000,
      ).toISOString(),
    };
    data.invites.push(invite);
    this.write(data);
    const { codeHash: _codeHash, ...safeInvite } = invite;
    return { invite: safeInvite, code };
  }

  createMemberLoginInvite(memberId: string, expiresInHours = 24): {
    invite: Omit<MemberInvite, "codeHash">;
    code: string;
  } {
    const data = this.read();
    const member = data.members.find((item) => item.id === memberId && item.enabled);
    if (!member) {
      throw new Error("成员不存在或已撤销。");
    }

    const timestamp = now();
    for (const invite of data.invites.filter((item) => (
      item.memberId === memberId && !item.redeemedAt && !item.revokedAt
    ))) {
      invite.revokedAt = timestamp;
    }

    const code = createInviteCode();
    const invite: MemberInvite = {
      id: `invite_${crypto.randomUUID()}`,
      memberId,
      memberName: member.name,
      codeHash: hashSecret(code),
      dailyLimit: member.dailyLimit,
      createdAt: timestamp,
      expiresAt: new Date(
        Date.now() + Math.max(1, Math.min(168, Number(expiresInHours) || 24)) * 60 * 60 * 1_000,
      ).toISOString(),
    };
    data.invites.push(invite);
    this.write(data);
    const { codeHash: _codeHash, ...safeInvite } = invite;
    return { invite: safeInvite, code };
  }

  redeemInvite(rawCode: string): {
    sessionToken: string;
    session: MemberSessionInfo;
  } {
    const code = normalizeInviteCode(rawCode);

    if (!code) {
      throw new Error("请输入邀请码。");
    }

    const data = this.read();
    const invite = data.invites.find((item) => (
      crypto.timingSafeEqual(
        Buffer.from(item.codeHash, "hex"),
        Buffer.from(hashSecret(code), "hex"),
      )
    ));

    if (!invite || invite.revokedAt || invite.redeemedAt || Date.parse(invite.expiresAt) <= Date.now()) {
      throw new Error("邀请码无效、已使用或已过期。");
    }

    const timestamp = now();
    const existingMember = invite.memberId
      ? data.members.find((item) => item.id === invite.memberId && item.enabled)
      : undefined;
    if (invite.memberId && !existingMember) {
      throw new Error("成员不存在或已撤销。");
    }
    const member: Member = existingMember || {
      id: `member_${crypto.randomUUID()}`,
      name: invite.memberName,
      enabled: true,
      dailyLimit: invite.dailyLimit,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (existingMember) {
      member.updatedAt = timestamp;
    }
    const sessionToken = `bst_${crypto.randomBytes(32).toString("base64url")}`;
    const session: MemberSession = {
      id: `session_${crypto.randomUUID()}`,
      memberId: member.id,
      tokenHash: hashSecret(sessionToken),
      createdAt: timestamp,
      lastSeenAt: timestamp,
      usageByDate: {},
    };
    invite.redeemedAt = timestamp;
    if (!existingMember) {
      data.members.push(member);
    }
    data.sessions.push(session);
    this.write(data);
    return {
      sessionToken,
      session: this.toSessionInfo(member, session, data.sessions),
    };
  }

  resolveSession(rawToken: string | undefined): MemberSessionInfo | undefined {
    const token = String(rawToken || "").trim();

    if (!token) {
      return undefined;
    }

    const data = this.read();
    const tokenHash = hashSecret(token);
    const session = data.sessions.find((item) => item.tokenHash === tokenHash);
    const member = session
      ? data.members.find((item) => item.id === session.memberId)
      : undefined;

    if (!session || !member || !member.enabled || session.revokedAt) {
      return undefined;
    }

    if (Date.now() - Date.parse(session.lastSeenAt) >= 5 * 60 * 1_000) {
      session.lastSeenAt = now();
      this.write(data);
    }

    return this.toSessionInfo(member, session, data.sessions);
  }

  consumeQuota(sessionId: string, amount: number): {
    allowed: boolean;
    quota: MemberQuota;
  } | undefined {
    const data = this.read();
    const session = data.sessions.find((item) => item.id === sessionId);
    const member = session
      ? data.members.find((item) => item.id === session.memberId)
      : undefined;

    if (!session || !member || !member.enabled || session.revokedAt) {
      return undefined;
    }

    const date = getUsageDate();
    const requestedAmount = Math.max(1, Math.ceil(amount));
    const memberSessions = data.sessions.filter((item) => item.memberId === member.id);
    const usedToday = this.memberUsageToday(memberSessions);

    if (usedToday + requestedAmount > member.dailyLimit) {
      return {
        allowed: false,
        quota: this.toQuota(member, memberSessions),
      };
    }

    session.usageByDate[date] = (session.usageByDate[date] || 0) + requestedAmount;
    this.write(data);
    return {
      allowed: true,
      quota: this.toQuota(member, memberSessions),
    };
  }

  refundQuota(sessionId: string, amount: number): void {
    const data = this.read();
    const session = data.sessions.find((item) => item.id === sessionId);

    if (!session) {
      return;
    }

    const date = getUsageDate();
    session.usageByDate[date] = Math.max(
      0,
      (session.usageByDate[date] || 0) - Math.max(1, Math.ceil(amount)),
    );
    this.write(data);
  }

  revokeSession(sessionId: string): boolean {
    const data = this.read();
    const session = data.sessions.find((item) => item.id === sessionId);

    if (!session || session.revokedAt) {
      return false;
    }

    session.revokedAt = now();
    this.write(data);
    return true;
  }

  revokeMember(memberId: string): boolean {
    const data = this.read();
    const member = data.members.find((item) => item.id === memberId);

    if (!member || !member.enabled) {
      return false;
    }

    const timestamp = now();
    member.enabled = false;
    member.updatedAt = timestamp;

    for (const session of data.sessions.filter((item) => item.memberId === memberId && !item.revokedAt)) {
      session.revokedAt = timestamp;
    }
    for (const invite of data.invites.filter((item) => (
      item.memberId === memberId && !item.redeemedAt && !item.revokedAt
    ))) {
      invite.revokedAt = timestamp;
    }

    this.write(data);
    return true;
  }

  revokeInvite(inviteId: string): boolean {
    const data = this.read();
    const invite = data.invites.find((item) => item.id === inviteId);

    if (!invite || invite.revokedAt || invite.redeemedAt) {
      return false;
    }

    invite.revokedAt = now();
    this.write(data);
    return true;
  }

  listForAdmin(): {
    invites: Array<Omit<MemberInvite, "codeHash"> & { status: string }>;
    members: Array<Member & { usedToday: number; remainingToday: number; sessionCount: number }>;
    sessions: Array<MemberSessionInfo & { revokedAt?: string }>;
  } {
    const data = this.read();
    const timestamp = Date.now();
    return {
      invites: data.invites
        .map(({ codeHash: _codeHash, ...invite }) => ({
          ...invite,
          status: invite.revokedAt
            ? "revoked"
            : invite.redeemedAt
              ? "redeemed"
              : Date.parse(invite.expiresAt) <= timestamp
                ? "expired"
                : "active",
        }))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      members: data.members
        .map((member) => {
          const sessions = data.sessions.filter((session) => session.memberId === member.id);
          const usedToday = sessions.reduce(
            (total, session) => total + (session.usageByDate[getUsageDate()] || 0),
            0,
          );
          return {
            ...member,
            usedToday,
            remainingToday: Math.max(0, member.dailyLimit - usedToday),
            sessionCount: sessions.filter((session) => !session.revokedAt).length,
          };
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      sessions: data.sessions
        .map((session) => {
          const member = data.members.find((item) => item.id === session.memberId);
          return {
            ...this.toSessionInfo(member || {
              id: session.memberId,
              name: "未知成员",
              enabled: false,
              dailyLimit: 0,
              createdAt: session.createdAt,
              updatedAt: session.createdAt,
            }, session, data.sessions),
            revokedAt: session.revokedAt,
          };
        })
        .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt)),
    };
  }

  private toSessionInfo(
    member: Member,
    session: MemberSession,
    sessions: MemberSession[] = [session],
  ): MemberSessionInfo {
    const quota = this.toQuota(member, sessions);
    return {
      id: session.id,
      memberId: member.id,
      memberName: member.name,
      dailyLimit: quota.dailyLimit,
      usedToday: quota.usedToday,
      remainingToday: quota.remainingToday,
      lastSeenAt: session.lastSeenAt,
    };
  }

  private memberUsageToday(sessions: MemberSession[]): number {
    const date = getUsageDate();
    return sessions.reduce((total, session) => total + (session.usageByDate[date] || 0), 0);
  }

  private toQuota(member: Member, sessions: MemberSession[]): MemberQuota {
    const usedToday = this.memberUsageToday(
      sessions.filter((session) => session.memberId === member.id),
    );
    return {
      dailyLimit: member.dailyLimit,
      usedToday,
      remainingToday: Math.max(0, member.dailyLimit - usedToday),
      resetsAt: getNextResetAt(),
    };
  }
}
