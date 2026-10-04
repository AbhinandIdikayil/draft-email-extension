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

export const DEFAULT_RESUME_URL =
  "https://drive.google.com/file/d/1QAKCxTWTs0olhfqsYvsfGKKhNkpvDEPQ/view?usp=sharing";
export const DEFAULT_RESUME_FILE_ID = "1QAKCxTWTs0olhfqsYvsfGKKhNkpvDEPQ";

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
  let name = fileMetadata.name || "Resume.pdf";
  let mimeType = fileMetadata.mimeType || "application/pdf";
  let data: Buffer;

  if (mimeType === "application/vnd.google-apps.document") {
    const response = await drive.files.export(
      { fileId, mimeType: "application/pdf" },
      { responseType: "arraybuffer" }
    );
    name = name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
    mimeType = "application/pdf";
    data = Buffer.from(response.data as ArrayBuffer);
  } else {
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );
    data = Buffer.from(response.data as ArrayBuffer);
  }

  return {
    fileId,
    name,
    mimeType,
    data
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
  const formattedAttachmentBase64 =
    attachmentBase64.match(/.{1,76}/g)?.join("\r\n") || attachmentBase64;
  const safeFilename = (attachment.name || "Resume.pdf").replace(/["\r\n\\]/g, "");

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
    `Content-Type: ${attachment.mimeType}; name="${safeFilename}"`,
    `Content-Disposition: attachment; filename="${safeFilename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    formattedAttachmentBase64,
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

export const DRAFT_TEMPLATES = ["default", "formal"] as const;
export type DraftTemplateId = (typeof DRAFT_TEMPLATES)[number];

export function resolveDraftTemplate(value: string): DraftTemplateId {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return (DRAFT_TEMPLATES as readonly string[]).includes(normalized)
    ? (normalized as DraftTemplateId)
    : "default";
}

type DraftHtmlContext = {
  escapedPlatform: string;
  escapedRole: string;
  escapedUrl: string;
  githubUrl: string;
  resumeUrl: string;
};

function buildDefaultDraftHtml(ctx: DraftHtmlContext): string {
  const { escapedPlatform, escapedRole, escapedUrl, githubUrl, resumeUrl } = ctx;

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f1a17;">
      <p>Dear hiring manager,</p>
      <p>Writing this email to express my interest in ${escapedRole} position, that I saw on <a href="${escapedUrl}">${escapedPlatform}</a>.</p>
      <p> I'm Abhinand, Full stack developer for the last year. I built the backend and frontend for some features that actually mattered: </p>
      <ul>
        <li>
        Rebuilt how we handled video streaming in the product catalog. Pages went from 10s load to 3s. Store owners saw the difference immediately.
        </li>
        <li>
        Built a WhatsApp automation system that eliminated the back-and-forth on routine stuff—feedback collection, order updates etc.
        </li>
        <li>
        Built an internal admin dashboard to automate store management, approvals and operational workflows.
        </li>
      </ul>
      <p> I'm looking to move somewhere I can keep doing this kind of work. Full-stack, backend etc. </p>
      <p>Hoping to hear back from you further</p>
      <p>
        <a href="${githubUrl}">GitHub</a>
        |
        <a href="${resumeUrl}">Resume</a>
      </p>
    </div>
  `;
}

function buildFormalDraftHtml(ctx: DraftHtmlContext): string {
  const { escapedPlatform, escapedRole, escapedUrl, githubUrl } = ctx;

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f1a17;">
      <p>Dear hiring manager,</p>
      <p>I am writing this email to express my interest in ${escapedRole} position, that I saw on <a href="${escapedUrl}">${escapedPlatform}</a>.</p>
      <p>I am a Full-Stack Developer with over 1+ YOE and hands-on expertise in NestJS, NodeJS, React, and Next.js. I have successfully built and deployed monolithic and microservice architectures on Cloud platforms (GCP, Azure, DigitalOcean) using Docker and Kubernetes.</p>
      <p>My expertise lies in databases like ClickHouse, Postgres, MongoDB and implementing WhatsApp automation. With a strong foundation in SOLID principles and a focus on clean code, I am eager to help your development team.</p>
      <p>Hoping to hear back from you further</p>
      <p>
        <a href="${githubUrl}">GitHub</a>
      </p>
    </div>
  `;
}

export function buildDraftHtml({
  platform,
  postUrl,
  roleTitle,
  template
}: {
  platform: string;
  postUrl: string;
  roleTitle: string;
  postText?: string;
  template?: string;
}): string {
  const safePlatform = normalizeWhitespace(platform) || "the post";
  const safeRole = compactRoleTitle(roleTitle) || "Full Stack Developer";
  const escapedPlatform = escapeHtml(safePlatform);
  const escapedRole = escapeHtml(safeRole);
  const escapedUrl = escapeHtml(postUrl || "#");

  const ctx: DraftHtmlContext = {
    escapedPlatform,
    escapedRole,
    escapedUrl,
    githubUrl: "https://github.com/AbhinandIdikayil/",
    resumeUrl: DEFAULT_RESUME_URL
  };

  return resolveDraftTemplate(template || "") === "formal"
    ? buildFormalDraftHtml(ctx)
    : buildDefaultDraftHtml(ctx);
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
