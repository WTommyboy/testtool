import crypto from "node:crypto";

export type AgentMessage<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  seq: number;
  type: string;
  timestamp: string;
  ack_required: boolean;
  payload: TPayload;
};

export type AckPayload = {
  in_reply_to: string;
};

export const createAgentMessage = <TPayload extends Record<string, unknown>>(
  type: string,
  payload: TPayload,
  options: { seq: number; id?: string; ackRequired?: boolean; timestamp?: string }
): AgentMessage<TPayload> => {
  return {
    id: options.id ?? `msg_${crypto.randomUUID()}`,
    seq: options.seq,
    type,
    timestamp: options.timestamp ?? new Date().toISOString(),
    ack_required: options.ackRequired ?? false,
    payload
  };
};

export const createAckMessage = (inReplyTo: string, seq: number): AgentMessage<AckPayload> => {
  return createAgentMessage("ack", { in_reply_to: inReplyTo }, { seq });
};
