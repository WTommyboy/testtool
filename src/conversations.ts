import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "./db";
import { askClaude } from "./claude";
import { config } from "./config";

const router = Router();

const conversationUploadRoot = path.resolve(config.storageRoot, "conversations_uploads");
fs.mkdirSync(conversationUploadRoot, { recursive: true });
const messageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, conversationUploadRoot),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname)}`)
  })
});

const createConversationSchema = z.object({
  title: z.string().min(1),
  featureName: z.string().optional()
});

const pushToRunSchema = z.object({
  roundId: z.string().min(1),
  location: z.string().min(1),
  featureMain: z.string().min(1),
  featureSub: z.string().min(1),
  runName: z.string().min(1),
  devUrl: z.string().url(),
  cases: z
    .array(
      z.object({
        caseNo: z.string().min(1),
        caseTitle: z.string().min(1),
        executionType: z.enum(["auto", "semi", "manual"]),
        detailJson: z.unknown().optional()
      })
    )
    .optional()
});

const nowIso = (): string => new Date().toISOString();

router.post("/", (req, res) => {
  const parsed = createConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `
      INSERT INTO conversations (id, title, feature_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(id, parsed.data.title, parsed.data.featureName ?? null, now, now);

  return res.status(201).json({ id });
});

router.get("/", (_req, res) => {
  const items = db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all();
  return res.json({ items });
});

router.get("/:id", (req, res) => {
  const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
  }
  const messages = db
    .prepare("SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(req.params.id);
  return res.json({ conversation, messages });
});

router.post("/:id/messages", messageUpload.array("attachments", 10), async (req, res) => {
  const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
  }

  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  let attachmentsFromBody: string[] = [];
  if (Array.isArray((req.body as { attachments?: unknown }).attachments)) {
    attachmentsFromBody = ((req.body as { attachments?: unknown }).attachments as unknown[])
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } else if (typeof (req.body as { attachments?: unknown }).attachments === "string") {
    const raw = (req.body as { attachments?: string }).attachments ?? "";
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        attachmentsFromBody = parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      }
    } catch {
      attachmentsFromBody = raw.trim() ? [raw.trim()] : [];
    }
  }
  const attachmentsFromFiles = files.map((f) => {
    const relPath = path.relative(process.cwd(), f.path);
    return `${f.originalname} (${relPath})`;
  });
  const attachments = [...attachmentsFromBody, ...attachmentsFromFiles];

  if (!content && attachments.length === 0) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", message: "content 或 attachments 至少要有一個" });
  }
  const userContent = content || `已上傳附件 ${attachments.length} 個`;

  const userMid = randomUUID();
  const now = nowIso();
  db.prepare(
    `
      INSERT INTO conversation_messages (id, conversation_id, role, content, attachments_json, created_at)
      VALUES (?, ?, 'user', ?, ?, ?)
    `
  ).run(userMid, req.params.id, userContent, JSON.stringify(attachments), now);

  const history = db
    .prepare("SELECT role, content FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(req.params.id) as Array<{ role: "user" | "assistant"; content: string }>;

  try {
    const assistantText = await askClaude(history);
    const assistantMid = randomUUID();
    db.prepare(
      `
        INSERT INTO conversation_messages (id, conversation_id, role, content, attachments_json, created_at)
        VALUES (?, ?, 'assistant', ?, ?, ?)
      `
    ).run(assistantMid, req.params.id, assistantText, "[]", nowIso());
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(nowIso(), req.params.id);

    return res.status(201).json({
      userMessageId: userMid,
      assistantMessageId: assistantMid,
      assistantContent: assistantText
    });
  } catch (error) {
    return res.status(502).json({
      error: "CLAUDE_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

router.post("/:id/export", (req, res) => {
  const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(req.params.id) as
    | { id: string; title: string; feature_name: string | null }
    | undefined;
  if (!conversation) {
    return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
  }

  const messages = db
    .prepare("SELECT role, content, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(req.params.id) as Array<{ role: string; content: string; created_at: string }>;

  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const safeTitle = conversation.title.replace(/[^\w\u4e00-\u9fff-]+/g, "_");
  const outDir = path.resolve(config.storageRoot, "conversations", req.params.id);
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, `testcase_${safeTitle}_${ts}.json`);
  const mdPath = path.join(outDir, `testcase_${safeTitle}_${ts}.md`);

  const payload = {
    conversationId: conversation.id,
    title: conversation.title,
    featureName: conversation.feature_name,
    exportedAt: nowIso(),
    messages
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const md = [
    `# Testcase Conversation Export`,
    ``,
    `- conversationId: ${conversation.id}`,
    `- title: ${conversation.title}`,
    `- feature: ${conversation.feature_name ?? ""}`,
    `- exportedAt: ${nowIso()}`,
    ``,
    `## Messages`,
    ...messages.map((m) => `### ${m.role.toUpperCase()} (${m.created_at})\n\n${m.content}\n`)
  ].join("\n");
  fs.writeFileSync(mdPath, md, "utf8");

  return res.json({ jsonPath, mdPath });
});

router.post("/:id/push-to-run", (req, res) => {
  const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
  }

  const parsed = pushToRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
  }

  const now = nowIso();
  const runId = randomUUID();
  db.prepare(
    `
      INSERT INTO runs (
        id, round_id, location, feature_main, feature_sub, run_name, dev_url, status, created_at, updated_at
      ) VALUES (
        @id, @round_id, @location, @feature_main, @feature_sub, @run_name, @dev_url, @status, @created_at, @updated_at
      )
    `
  ).run({
    id: runId,
    round_id: parsed.data.roundId,
    location: parsed.data.location,
    feature_main: parsed.data.featureMain,
    feature_sub: parsed.data.featureSub,
    run_name: parsed.data.runName,
    dev_url: parsed.data.devUrl,
    status: "READY",
    created_at: now,
    updated_at: now
  });

  if (parsed.data.cases?.length) {
    const stmt = db.prepare(
      `
        INSERT INTO run_cases (
          id, run_id, case_no, case_title, execution_type, result_status, detail_json, created_at, updated_at
        ) VALUES (
          @id, @run_id, @case_no, @case_title, @execution_type, @result_status, @detail_json, @created_at, @updated_at
        )
      `
    );
    for (const c of parsed.data.cases) {
      stmt.run({
        id: randomUUID(),
        run_id: runId,
        case_no: c.caseNo,
        case_title: c.caseTitle,
        execution_type: c.executionType,
        result_status: c.executionType === "manual" ? "MANUAL_PENDING" : "PENDING",
        detail_json: c.detailJson ? JSON.stringify(c.detailJson) : null,
        created_at: now,
        updated_at: now
      });
    }
  }

  return res.status(201).json({
    conversationId: req.params.id,
    runId,
    importedCases: parsed.data.cases?.length ?? 0
  });
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM conversation_messages WHERE conversation_id = ?").run(req.params.id);
  db.prepare("DELETE FROM conversations WHERE id = ?").run(req.params.id);
  return res.status(204).send();
});

export default router;
