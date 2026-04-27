import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { db } from "../db";

export type AgentTokenRecord = {
  id: string;
  token_prefix: string;
  device_name: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

const tokenHashSecret = (): string => {
  return process.env.AGENT_TOKEN_HASH_SECRET
    || process.env.SESSION_SECRET
    || process.env.AGENT_BOOTSTRAP_SECRET
    || process.env.MAC_AGENT_BOOTSTRAP_TOKEN
    || "dev-agent-token-hash-secret";
};

const hashToken = (token: string): string => {
  return createHmac("sha256", tokenHashSecret()).update(token).digest("hex");
};

const maskToken = (tokenPrefix: string): string => `${tokenPrefix}...`;

export const createAgentToken = (deviceName: string): { id: string; token: string; deviceName: string; maskedToken: string } => {
  const token = `uatagt_${randomBytes(32).toString("base64url")}`;
  const tokenPrefix = token.slice(0, 14);
  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO agent_tokens (id, token_hash, token_prefix, device_name, created_at)
      VALUES (@id, @token_hash, @token_prefix, @device_name, @created_at)
    `
  ).run({
    id,
    token_hash: hashToken(token),
    token_prefix: tokenPrefix,
    device_name: deviceName,
    created_at: new Date().toISOString()
  });
  return { id, token, deviceName, maskedToken: maskToken(tokenPrefix) };
};

export const listAgentTokens = (): Array<AgentTokenRecord & { masked_token: string }> => {
  const rows = db
    .prepare(
      `
        SELECT id, token_prefix, device_name, created_at, last_seen_at, revoked_at
        FROM agent_tokens
        ORDER BY created_at DESC
      `
    )
    .all() as AgentTokenRecord[];
  return rows.map((row) => ({ ...row, masked_token: maskToken(row.token_prefix) }));
};

export const revokeAgentToken = (id: string): boolean => {
  const result = db
    .prepare("UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
    .run(new Date().toISOString(), id);
  return result.changes > 0;
};

export const validateAgentToken = (token: string): boolean => {
  const row = db
    .prepare("SELECT id FROM agent_tokens WHERE token_hash = ? AND revoked_at IS NULL")
    .get(hashToken(token)) as { id: string } | undefined;
  if (!row) return false;
  db.prepare("UPDATE agent_tokens SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return true;
};
