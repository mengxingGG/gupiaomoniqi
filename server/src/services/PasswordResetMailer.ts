import nodemailer, { type Transporter } from "nodemailer";

export interface PasswordResetMail {
  to: string;
  code: string;
  expiresInMinutes: number;
}

export interface EmailVerificationMail extends PasswordResetMail {}

export interface PasswordResetMailer {
  sendPasswordResetCode(mail: PasswordResetMail): Promise<void>;
  sendEmailVerificationCode(mail: EmailVerificationMail): Promise<void>;
  sendRegistrationEmailVerificationCode(
    mail: EmailVerificationMail,
  ): Promise<void>;
}

export interface SmtpMailerConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export class SmtpPasswordResetMailer implements PasswordResetMailer {
  readonly #transport: Transporter;

  constructor(
    private readonly from: string,
    options: {
      host: string;
      port: number;
      secure: boolean;
      requireTls: boolean;
      username?: string;
      password?: string;
    },
  ) {
    this.#transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      requireTLS: options.requireTls,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      auth:
        options.username && options.password
          ? {
              user: options.username,
              pass: options.password,
            }
          : undefined,
    });
  }

  async sendPasswordResetCode(mail: PasswordResetMail): Promise<void> {
    await this.#sendCodeMail({
      ...mail,
      subject: "股票模拟器密码找回验证码",
      introduction: "你正在找回股票模拟器账户密码。",
    });
  }

  async sendEmailVerificationCode(
    mail: EmailVerificationMail,
  ): Promise<void> {
    await this.#sendCodeMail({
      ...mail,
      subject: "股票模拟器邮箱绑定验证码",
      introduction: "你正在为股票模拟器账户补充找回邮箱。",
    });
  }

  async sendRegistrationEmailVerificationCode(
    mail: EmailVerificationMail,
  ): Promise<void> {
    await this.#sendCodeMail({
      ...mail,
      subject: "股票模拟器注册邮箱验证码",
      introduction: "你正在验证股票模拟器新账户的注册邮箱。",
    });
  }

  async #sendCodeMail(mail: PasswordResetMail & {
    subject: string;
    introduction: string;
  }): Promise<void> {
    await this.#transport.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: [
        mail.introduction,
        `你的验证码是：${mail.code}`,
        `验证码将在 ${mail.expiresInMinutes} 分钟后失效。`,
        "如果不是你本人操作，请忽略这封邮件。",
      ].join("\n"),
      html: [
        `<p>${mail.introduction}</p>`,
        `<p style=\"font-size:28px;font-weight:700;letter-spacing:6px\">${mail.code}</p>`,
        `<p>验证码将在 ${mail.expiresInMinutes} 分钟后失效。</p>`,
        "<p>如果不是你本人操作，请忽略这封邮件。</p>",
      ].join(""),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
}

export function createPasswordResetMailerFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): PasswordResetMailer | null {
  const host = environment.SMTP_HOST?.trim();
  const from = environment.SMTP_FROM?.trim();
  if (!host || !from) {
    return null;
  }

  const secure = parseBoolean(environment.SMTP_SECURE, false);
  const port = boundedPort(
    environment.SMTP_PORT,
    secure ? 465 : 587,
  );
  return new SmtpPasswordResetMailer(from, {
    host,
    port,
    secure,
    requireTls: parseBoolean(environment.SMTP_REQUIRE_TLS, !secure),
    username: environment.SMTP_USER?.trim(),
    password: environment.SMTP_PASSWORD,
  });
}

export function createPasswordResetMailerFromConfig(
  config: SmtpMailerConfig,
): PasswordResetMailer {
  return new SmtpPasswordResetMailer(config.from, {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTls: config.requireTls,
    username: config.user,
    password: config.pass,
  });
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value.trim().toLowerCase() === "true";
}

function boundedPort(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535
    ? parsed
    : fallback;
}
