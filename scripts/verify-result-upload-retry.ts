import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { uploadResultXlsx } from "../agent/src/task-runner";

const createWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Result");
  sheet.addRow(["Case No", "Result"]);
  sheet.addRow(["BIUI_COLLAGE_R001-B-04", "PASS"]);
  await workbook.xlsx.writeFile(filePath);
};

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-result-upload-retry-"));
  const xlsxPath = path.join(tempRoot, "result.xlsx");
  await createWorkbook(xlsxPath);

  let attempts = 0;
  const receivedBodies: Buffer[] = [];
  const server = http.createServer((req, res) => {
    attempts += 1;
    if (attempts === 1) {
      req.socket.destroy(new Error("fixture socket terminated before upload response"));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      receivedBodies.push(Buffer.concat(chunks));
      if (attempts === 2) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "temporary upstream failure" }));
        return;
      }
      assert.equal(req.method, "POST");
      assert.equal(req.headers.authorization, "Bearer test-token");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, attempts }));
    });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const retryEvents: Array<{ attempt: number; nextDelayMs: number; error: string }> = [];
    const response = await uploadResultXlsx(
      `http://127.0.0.1:${port}/upload`,
      xlsxPath,
      "test-token",
      {
        resultSource: "codex_generated",
        currentCaseNo: "BIUI_COLLAGE_R001-B-04",
        expectedCaseNos: ["BIUI_COLLAGE_R001-B-04"]
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 1,
        onRetry: ({ attempt, nextDelayMs, error }) => {
          retryEvents.push({ attempt, nextDelayMs, error: error.message });
        }
      }
    );

    assert.deepEqual(response, { ok: true, attempts: 3 });
    assert.equal(attempts, 3);
    assert.equal(retryEvents.length, 2);
    assert.match(retryEvents[0]?.error ?? "", /fetch failed|socket|terminated/i);
    assert.match(retryEvents[1]?.error ?? "", /RESULT_UPLOAD_FAILED 503/);
    assert.ok(receivedBodies.every((body) => body.includes(Buffer.from("codex_generated"))));

    console.log(JSON.stringify({
      ok: true,
      fixture: "result-upload-retry",
      attempts,
      retryEvents
    }, null, 2));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
