import fs from "fs";
import path from "path";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export const REFRESH_TOKEN_PATH = path.join(process.cwd(), ".env_refresh");

export function normalizeWhitespace(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function toTitleCase(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function extractEmails(text: string): string[] {
  const normalized = String(text || "")
    .normalize("NFKC")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ");

  const matches =
    normalized.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];

  return [...new Set(matches.map((email) => email.trim()))];
}

export function toBase64Url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function encodeBase64(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\r?\n/g, "");
}

export function loadRefreshToken(): string {
  if (process.env.REFRESH_TOKEN) {
    return process.env.REFRESH_TOKEN.trim();
  }

  if (!fs.existsSync(REFRESH_TOKEN_PATH)) {
    return "";
  }

  const raw = fs.readFileSync(REFRESH_TOKEN_PATH, "utf8").trim();
  if (!raw) {
    return "";
  }

  if (raw.includes("=")) {
    return raw.split("=").slice(1).join("=").trim();
  }

  return raw;
}

export function saveRefreshToken(refreshToken: string): void {
  fs.writeFileSync(REFRESH_TOKEN_PATH, `REFRESH_TOKEN=${refreshToken}\n`, "utf8");
}

export function getOAuthClient(redirectUri: string): OAuth2Client {
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing CLIENT_ID or CLIENT_SECRET in backend/.env.");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildDraftMessage({
  to,
  subject,
  html
}: {
  to: string;
  subject: string;
  html: string;
}): string {
  const headers = [
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    `Subject: ${subject}`
  ];

  if (to) {
    headers.unshift(`To: ${to}`);
  }

  const rawMessage = `${headers.join("\r\n")}\r\n\r\n${html}`;
  return toBase64Url(rawMessage);
}

export function compactRoleTitle(value: string): string {
  let cleaned = normalizeWhitespace(value).replace(/^Associate\s+/i, "");
  const firstChunk = cleaned.split(/\s*(?:\||•|–|—|-)\s*/)[0] ?? "";

  cleaned = firstChunk
    .replace(
      /\s+(?:Location|Company|Experience|Posted|Feed post|Apply|Applicants?|Job|Hiring)\b.*$/i,
      ""
    )
    .replace(/[\u{1F300}-\u{1FAFF}].*$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned;
}

export type DriveAttachment = {
  fileId: string;
  name: string;
  mimeType: string;
  data: Buffer;
};

export function extractGoogleDriveFileId(input: string): string {
  const value = normalizeWhitespace(input);
  if (!value) {
    return "";
  }

  const fileMatch = value.match(/\/file\/d\/([a-zA-Z0-9_-]+)/i);
  if (fileMatch?.[1]) {
    return fileMatch[1];
  }

  const idMatch = value.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  if (idMatch?.[1]) {
    return idMatch[1];
  }

  if (/drive\.google\.com/i.test(value) && /\/folders\//i.test(value)) {
    throw new Error(
      "Google Drive folder links cannot be attached directly. Provide a file URL or file ID instead."
    );
  }

  return value;
}

export async function fetchDriveAttachment(
  auth: OAuth2Client,
  fileIdOrUrl: string
): Promise<DriveAttachment> {
  const drive = google.drive({ version: "v3", auth });
  const fileId = extractGoogleDriveFileId(fileIdOrUrl);

  if (!fileId) {
    throw new Error("Missing Google Drive file ID.");
  }

  const metadata = await drive.files.get({
    fileId,
    fields: "name, mimeType"
  });

  const fileMetadata = metadata.data as { name?: string; mimeType?: string };
  const name = fileMetadata.name || "attachment";
  const mimeType = fileMetadata.mimeType || "application/octet-stream";

  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );

  return {
    fileId,
    name,
    mimeType,
    data: Buffer.from(response.data as ArrayBuffer)
  };
}

export function buildDraftMessageWithAttachment({
  to,
  subject,
  html,
  attachment
}: {
  to: string;
  subject: string;
  html: string;
  attachment: DriveAttachment;
}): string {
  const boundary = `boundary_${Date.now().toString(16)}`;
  const attachmentBase64 = encodeBase64(attachment.data);
  const htmlPart = [
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    ""
  ];
  const attachmentPart = [
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}; name="${escapeHtml(attachment.name)}"`,
    `Content-Disposition: attachment; filename="${escapeHtml(attachment.name)}"`,
    "Content-Transfer-Encoding: base64",
    "",
    attachmentBase64,
    ""
  ];

  const headers = [
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    `Subject: ${subject}`
  ];

  if (to) {
    headers.unshift(`To: ${to}`);
  }

  const rawMessage = [
    ...headers,
    "",
    ...htmlPart,
    ...attachmentPart,
    `--${boundary}--`
  ].join("\r\n");

  return toBase64Url(rawMessage);
}

export function buildDraftHtml({
  platform,
  postUrl,
  roleTitle,
  postText
}: {
  platform: string;
  postUrl: string;
  roleTitle: string;
  postText: string;
}): string {
  const safePlatform = normalizeWhitespace(platform) || "the post";
  const safeRole = compactRoleTitle(roleTitle) || "the role";
  const safeText = normalizeWhitespace(postText) || "No page text was captured.";
  const escapedPlatform = escapeHtml(safePlatform);
  const escapedRole = escapeHtml(safeRole);
  const escapedText = escapeHtml(safeText).replace(/\n/g, "<br>");
  const escapedUrl = escapeHtml(postUrl || "#");
  const linkedinUrl = "https://www.linkedin.com/in/abhinand-i-1a793a2a7/";
  const githubUrl = "https://github.com/AbhinandIdikayil/";

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f1a17;">
      <p>Dear hiring manager,</p>
      <p>I am writing this email to express my interest in ${escapedRole} position, that I saw on <a href="${escapedUrl}">${escapedPlatform}</a>.</p>
      <p>I am an experienced Full-Stack Developer with hands-on expertise in <strong>NestJS</strong> <strong>NodeJS</strong>, <strong>React</strong>, and <strong>Next.js</strong>. I have successfully built and deployed monolithic and microservice architectures on Cloud platforms (GCP, Azure, DigitalOcean) using <strong>Docker</strong> and <strong>Kubernetes</strong>.</p>
      <p>My expertise lies in databases like <strong>ClickHouse</strong>, <strong>Postgres</strong>, <strong>MongoDB</strong> and implementing WhatsApp automation. With a strong foundation in <strong>SOLID principles</strong> and a focus on clean code, I am eager to help your development team.</p>
      <p>Hoping to hear back from you further</p>
      <p>
        <a href="${linkedinUrl}">LinkedIn</a>
        <br>
        <a href="${githubUrl}">GitHub</a>
      </p>
    </div>
  `;
}

export function bestRecipientEmail(body: {
  recipientEmail?: string;
  emails?: string[];
  postText?: string;
  roleTitle?: string;
}): string {
  const candidates = [
    body.recipientEmail,
    ...(Array.isArray(body.emails) ? body.emails : []),
    ...extractEmails(`${body.postText || ""}\n${body.roleTitle || ""}`)
  ];

  return (
    candidates
      .map((email) => String(email || "").trim().normalize("NFKC"))
      .find((email) => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) ||
    ""
  );
}

export function buildDraftSubject(roleTitle: string): string {
  const cleanedRole = compactRoleTitle(roleTitle);
  const displayRole = cleanedRole ? toTitleCase(cleanedRole) : "Full Stack Developer";

  return `Application - ${displayRole} - Abhinand`;
}
