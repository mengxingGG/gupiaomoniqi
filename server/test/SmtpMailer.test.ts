import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../src/application.js";
import { SmtpPasswordResetMailer } from "../src/services/PasswordResetMailer.js";
import { createTestHarness } from "./helpers.js";

const servers: ReturnType<typeof createServer>[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("SMTP 出站验证码", () => {
  it("通过真实 SMTP 会话发送邮箱绑定六位码且不需要收件能力", async () => {
    let resolveMessage!: (message: string) => void;
    const receivedMessage = new Promise<string>((resolve) => {
      resolveMessage = resolve;
    });
    const server = createServer((socket) =>
      handleSmtpConnection(socket, resolveMessage),
    );
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("SMTP_TEST_ADDRESS_UNAVAILABLE");
    }
    const mailer = new SmtpPasswordResetMailer(
      "股票模拟器 <mailer@example.com>",
      {
        host: "127.0.0.1",
        port: address.port,
        secure: false,
        requireTls: false,
      },
    );

    await mailer.sendEmailVerificationCode({
      to: "legacy@example.com",
      code: "246810",
      expiresInMinutes: 10,
    });
    const message = await receivedMessage;

    expect(message).toContain("To: legacy@example.com");
    expect(message).toContain("246810");
    expect(message).toContain("text/plain");
    expect(message).not.toContain("POP3");
    expect(message).not.toContain("IMAP");
  }, 10_000);

  it("从持久 config.json 启用 SMTP，配置文件缺失时启动不崩溃", async () => {
    let resolveMessage!: (message: string) => void;
    const receivedMessage = new Promise<string>((resolve) => {
      resolveMessage = resolve;
    });
    const smtpServer = createServer((socket) =>
      handleSmtpConnection(socket, resolveMessage),
    );
    servers.push(smtpServer);
    await new Promise<void>((resolve) => {
      smtpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const smtpAddress = smtpServer.address();
    if (!smtpAddress || typeof smtpAddress === "string") {
      throw new Error("SMTP_TEST_ADDRESS_UNAVAILABLE");
    }

    const directory = await mkdtemp(join(tmpdir(), "gupiaomoniqi-config-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        smtp: {
          host: "127.0.0.1",
          port: smtpAddress.port,
          secure: false,
          requireTls: false,
          from: "股票模拟器 <mailer@example.com>",
        },
      }),
      "utf8",
    );
    const { repository } = await createTestHarness({ registerAccount: false });
    const configured = await createApplication({
      repository,
      rootConfigPath: configPath,
    });
    try {
      const health = await configured.app.inject({
        method: "GET",
        url: "/api/health",
      });
      expect(health.json().data.emailDelivery).toEqual({
        configured: true,
        mode: "SMTP_SEND_ONLY",
        registrationVerificationRequired: true,
      });
      const requested = await configured.app.inject({
        method: "POST",
        url: "/api/account/email-verification/request",
        payload: {
          email: "new-user@example.com",
          purpose: "REGISTRATION",
        },
      });
      expect(requested.statusCode).toBe(202);
      const message = await receivedMessage;
      expect(message).toContain("To: new-user@example.com");
      expect(decodePlainTextBody(message)).toMatch(/\b\d{6}\b/u);
    } finally {
      await configured.app.close();
    }

    const missing = await createApplication({
      repository,
      rootConfigPath: join(directory, "missing.json"),
    });
    try {
      const health = await missing.app.inject({
        method: "GET",
        url: "/api/health",
      });
      expect(health.json().data.emailDelivery.configured).toBe(false);
    } finally {
      await missing.app.close();
    }
  });
});

function decodePlainTextBody(message: string): string {
  const encoded = message.match(
    /Content-Type: text\/plain[^]*?Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/u,
  )?.[1];
  if (!encoded) {
    throw new Error("SMTP_TEST_TEXT_BODY_MISSING");
  }
  return Buffer.from(encoded.replace(/\s/gu, ""), "base64").toString("utf8");
}

function handleSmtpConnection(
  socket: Socket,
  onMessage: (message: string) => void,
): void {
  let buffer = "";
  let dataMode = false;
  socket.setEncoding("utf8");
  socket.write("220 localhost test SMTP\r\n");
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      if (dataMode) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end < 0) {
          return;
        }
        const message = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        dataMode = false;
        onMessage(message);
        socket.write("250 2.0.0 queued\r\n");
        continue;
      }

      const lineEnd = buffer.indexOf("\r\n");
      if (lineEnd < 0) {
        return;
      }
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 2);
      if (/^EHLO\b/i.test(line)) {
        socket.write("250-localhost\r\n250 PIPELINING\r\n");
      } else if (/^(MAIL FROM|RCPT TO)\b/i.test(line)) {
        socket.write("250 2.1.0 ok\r\n");
      } else if (/^DATA\b/i.test(line)) {
        dataMode = true;
        socket.write("354 end with <CRLF>.<CRLF>\r\n");
      } else if (/^QUIT\b/i.test(line)) {
        socket.write("221 2.0.0 bye\r\n");
        socket.end();
      } else if (line.length > 0) {
        socket.write("250 2.0.0 ok\r\n");
      }
    }
  });
}
