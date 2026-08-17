import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SmtpPasswordResetMailer } from "../src/services/PasswordResetMailer.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
});

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
