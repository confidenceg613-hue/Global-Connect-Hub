import { eq, desc } from "drizzle-orm";
import {
  db,
  userAccessTable,
  subscriptionCodesTable,
  codeRedemptionsTable,
  type SubscriptionCode,
  type UserAccess,
} from "@workspace/db";

const DEFAULT_FREE_ACCESS_LIMIT = 3;
const DEFAULT_CODE_DURATION_DAYS = 7;

// Bank transfer details shown to the user once their free accesses / weekly
// code have run out. Kept in one place so the payment instructions can't
// drift between endpoints.
export const BANK_DETAILS = {
  amountNaira: 500,
  accountNumber: "9160547567",
  bankName: "Opay",
  accountName: "Godwin Confidence Onyedikachi",
  whatsappNumber: "09160547567",
  instructions:
    "Pay ₦500 via bank transfer, then send your payment receipt to the WhatsApp number above to receive your weekly activation code.",
};

export type AccessStatus = {
  allowed: boolean;
  status: "unlimited" | "subscribed" | "free" | "expired" | "locked";
  freeAccessesUsed: number;
  freeAccessLimit: number;
  freeAccessesRemaining: number;
  accessExpiresAt: string | null;
  message: string;
};

async function getOrCreateUserAccess(userId: number): Promise<UserAccess> {
  const [existing] = await db
    .select()
    .from(userAccessTable)
    .where(eq(userAccessTable.userId, userId));
  if (existing) return existing;

  const [created] = await db
    .insert(userAccessTable)
    .values({ userId, freeAccessLimit: DEFAULT_FREE_ACCESS_LIMIT })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Another concurrent request created the row first — read it back.
  const [row] = await db
    .select()
    .from(userAccessTable)
    .where(eq(userAccessTable.userId, userId));
  return row;
}

function evaluate(row: UserAccess): AccessStatus {
  const now = new Date();
  const remaining = Math.max(row.freeAccessLimit - row.freeAccessesUsed, 0);
  const accessExpiresAt = row.accessExpiresAt
    ? row.accessExpiresAt.toISOString()
    : null;

  if (row.hasUnlimitedAccess) {
    return {
      allowed: true,
      status: "unlimited",
      freeAccessesUsed: row.freeAccessesUsed,
      freeAccessLimit: row.freeAccessLimit,
      freeAccessesRemaining: remaining,
      accessExpiresAt: null,
      message: "Unlimited access.",
    };
  }

  if (row.accessExpiresAt && row.accessExpiresAt > now) {
    return {
      allowed: true,
      status: "subscribed",
      freeAccessesUsed: row.freeAccessesUsed,
      freeAccessLimit: row.freeAccessLimit,
      freeAccessesRemaining: remaining,
      accessExpiresAt,
      message: `Subscription active until ${accessExpiresAt}.`,
    };
  }

  if (row.freeAccessesUsed < row.freeAccessLimit) {
    return {
      allowed: true,
      status: "free",
      freeAccessesUsed: row.freeAccessesUsed,
      freeAccessLimit: row.freeAccessLimit,
      freeAccessesRemaining: remaining,
      accessExpiresAt,
      message: `${remaining} free access${remaining === 1 ? "" : "es"} remaining.`,
    };
  }

  const wasSubscribed = row.accessExpiresAt !== null;
  return {
    allowed: false,
    status: wasSubscribed ? "expired" : "locked",
    freeAccessesUsed: row.freeAccessesUsed,
    freeAccessLimit: row.freeAccessLimit,
    freeAccessesRemaining: 0,
    accessExpiresAt,
    message: wasSubscribed
      ? "Your weekly subscription has expired. Pay again to receive a new code."
      : "You've used all your free accesses. Pay to receive a subscription code.",
  };
}

/** Read-only status check — does not consume a free access. */
export async function getAccessStatus(userId: number): Promise<AccessStatus> {
  const row = await getOrCreateUserAccess(userId);
  return evaluate(row);
}

/**
 * Call this once per "use" of the app (e.g. on launch / check-in), not on
 * every API request. Consumes one free access if the user has no active
 * subscription and still has free accesses left; otherwise leaves the
 * counter untouched and reports whether access is allowed.
 */
export async function consumeAccess(userId: number): Promise<AccessStatus> {
  const row = await getOrCreateUserAccess(userId);
  const now = new Date();
  const hasActiveGrant =
    row.hasUnlimitedAccess || (row.accessExpiresAt !== null && row.accessExpiresAt > now);

  if (hasActiveGrant) {
    return evaluate(row);
  }

  if (row.freeAccessesUsed >= row.freeAccessLimit) {
    return evaluate(row);
  }

  const [updated] = await db
    .update(userAccessTable)
    .set({ freeAccessesUsed: row.freeAccessesUsed + 1, updatedAt: now })
    .where(eq(userAccessTable.userId, userId))
    .returning();

  // This request itself was a legitimate free access (checked against the
  // pre-increment count above), so it must be reported as allowed even
  // though it may have just used up the last one — evaluate() judges
  // *current* standing, not whether the action that just happened was ok.
  const remaining = Math.max(updated.freeAccessLimit - updated.freeAccessesUsed, 0);
  return {
    allowed: true,
    status: "free",
    freeAccessesUsed: updated.freeAccessesUsed,
    freeAccessLimit: updated.freeAccessLimit,
    freeAccessesRemaining: remaining,
    accessExpiresAt: null,
    message:
      remaining > 0
        ? `${remaining} free access${remaining === 1 ? "" : "es"} remaining.`
        : "This was your last free access. Pay to receive a subscription code next time.",
  };
}

export type RedeemResult =
  | { success: true; status: AccessStatus }
  | {
      success: false;
      reason: "invalid" | "revoked" | "exhausted";
      message: string;
    };

/** Validates and applies a subscription code entered by a user. */
export async function redeemCode(
  userId: number,
  rawCode: string,
): Promise<RedeemResult> {
  const code = rawCode.trim();
  if (!code) {
    return {
      success: false,
      reason: "invalid",
      message: "Enter a subscription code.",
    };
  }

  const [codeRow] = await db
    .select()
    .from(subscriptionCodesTable)
    .where(eq(subscriptionCodesTable.code, code));

  if (!codeRow) {
    return {
      success: false,
      reason: "invalid",
      message: "Invalid code. Please pay again to receive a valid code.",
    };
  }
  if (codeRow.isRevoked) {
    return {
      success: false,
      reason: "revoked",
      message: "This code is no longer valid. Please pay again to receive a new code.",
    };
  }
  if (
    codeRow.maxRedemptions !== null &&
    codeRow.redemptionCount >= codeRow.maxRedemptions
  ) {
    return {
      success: false,
      reason: "exhausted",
      message: "This code has already been used up. Please pay again to receive a new code.",
    };
  }

  await getOrCreateUserAccess(userId);

  const now = new Date();
  const isUnlimited = codeRow.durationDays === null;
  const expiresAt = isUnlimited
    ? null
    : new Date(now.getTime() + codeRow.durationDays! * 24 * 60 * 60 * 1000);

  const [updatedAccess] = await db
    .update(userAccessTable)
    .set({
      accessExpiresAt: expiresAt,
      hasUnlimitedAccess: isUnlimited,
      activeCodeId: codeRow.id,
      updatedAt: now,
    })
    .where(eq(userAccessTable.userId, userId))
    .returning();

  await db.insert(codeRedemptionsTable).values({
    userId,
    codeId: codeRow.id,
    redeemedAt: now,
    expiresAt,
  });

  await db
    .update(subscriptionCodesTable)
    .set({ redemptionCount: codeRow.redemptionCount + 1 })
    .where(eq(subscriptionCodesTable.id, codeRow.id));

  return { success: true, status: evaluate(updatedAccess) };
}

// ---- Admin-only management (mounted behind requireAdmin) ----

export async function createCode(input: {
  code: string;
  label?: string | null;
  durationDays?: number | null;
  maxRedemptions?: number | null;
}): Promise<SubscriptionCode> {
  const [row] = await db
    .insert(subscriptionCodesTable)
    .values({
      code: input.code.trim(),
      label: input.label ?? null,
      durationDays:
        input.durationDays === undefined
          ? DEFAULT_CODE_DURATION_DAYS
          : input.durationDays,
      maxRedemptions: input.maxRedemptions ?? null,
    })
    .returning();
  return row;
}

export async function listCodes(): Promise<SubscriptionCode[]> {
  return db
    .select()
    .from(subscriptionCodesTable)
    .orderBy(desc(subscriptionCodesTable.createdAt));
}

export async function revokeCode(id: number): Promise<SubscriptionCode | null> {
  const [row] = await db
    .update(subscriptionCodesTable)
    .set({ isRevoked: true })
    .where(eq(subscriptionCodesTable.id, id))
    .returning();
  return row ?? null;
}
