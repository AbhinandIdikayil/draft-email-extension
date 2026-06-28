import { Router, type Request, type Response } from "express";
import { google } from "googleapis";
import {
  bestRecipientEmail,
  buildDraftHtml,
  buildDraftSubject,
  buildDraftMessage,
  buildDraftMessageWithAttachment,
  fetchDriveAttachment,
  getOAuthClient,
  loadRefreshToken,
  normalizeWhitespace,
  saveRefreshToken
} from "../lib/outreach.js";

const router = Router();
const PORT = Number(process.env.PORT || 5000);
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/oauth2callback`;


router.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});


router.get("/auth", (_req: Request, res: Response) => {
  try {
    const oauthClient = getOAuthClient(REDIRECT_URI);
    const authUrl = oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/drive.readonly"
      ]
    });

    res.redirect(authUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown auth error";
    res.status(500).send(message);
  }
});



router.get("/oauth2callback", async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";

  if (!code) {
    return res.status(400).send("Missing OAuth code.");
  }

  try {
    const oauthClient = getOAuthClient(REDIRECT_URI);
    const { tokens } = await oauthClient.getToken(code);

    if (tokens.refresh_token) {
      saveRefreshToken(tokens.refresh_token);
    }

    res.send(
      "Authentication successful. You can close this tab and return to the extension."
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OAuth error";
    res.status(500).send(`OAuth error: ${message}`);
  }
});



router.post("/create-draft", async (req: Request, res: Response) => {
  try {
    const refreshToken = loadRefreshToken();
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: "No refresh token found. Visit /auth first."
      });
    }

    const oauthClient = getOAuthClient(REDIRECT_URI);
    oauthClient.setCredentials({ refresh_token: refreshToken });

    const gmail = google.gmail({ version: "v1", auth: oauthClient });
    const recipientEmail = bestRecipientEmail(req.body);
    const roleTitle = normalizeWhitespace(req.body.roleTitle);
    const platform = normalizeWhitespace(req.body.platform);
    const postUrl = normalizeWhitespace(req.body.postUrl);
    const postText = normalizeWhitespace(req.body.postText);
    const attachmentSource = normalizeWhitespace(
      req.body.driveFileId || req.body.driveFileUrl || req.body.attachmentFileId || req.body.attachmentUrl || req.body.resumeUrl
    );

    const subject = buildDraftSubject(roleTitle);
    const html = buildDraftHtml({ platform, postUrl, roleTitle, postText });
    const attachment = attachmentSource ? await fetchDriveAttachment(oauthClient, attachmentSource) : null;
    const raw = attachment
      ? buildDraftMessageWithAttachment({ to: recipientEmail, subject, html, attachment })
      : buildDraftMessage({ to: recipientEmail, subject, html });

    const response = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { raw }
      }
    });

    res.json({
      success: true,
      draftId: response.data.id,
      recipientEmail: recipientEmail || null,
      attachment: attachment
        ? {
            fileId: attachment.fileId,
            name: attachment.name,
            mimeType: attachment.mimeType
          }
        : null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown draft error";
    res.status(500).json({
      success: false,
      error: message
    });
  }
});


export default router;
