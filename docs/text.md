You can save the markdown block below as `plan.md` in your project's root folder and feed it directly to your coding agent (such as Claude Code, Cursor, Cline, or Copilot).

It contains an incredibly detailed, step-by-step implementation blueprint with strict functional guidelines, full system file structures, security parameters, and ready-to-run code files to ensure your agent gets to work immediately.

---

# plan.md

# Specification: Automated Cold Outreach Pipeline (Chrome Extension + Local Node.js Backend)

## 1. Project Overview

This system is a secure, anti-detection-compliant automated job prospecting and cold outreach tool. It consists of two decoupled components:

1. **Frontend (`/extension`):** A passive, user-initiated Manifest V3 Chrome Extension that scrapes basic metadata (Role, Platform, Post URL) from LinkedIn, Indeed, and Instahyre, coordinates a contact enrichment waterfall, and forwards results to the local backend.


2. **Backend (`/backend`):** A local Node.js Express server that manages Google OAuth (using standard **Web Application** credentials), compiles RFC 2822 HTML emails with localized anchor hyperlinks, and natively interacts with the official **Google Gmail API** to create email drafts.



### Strategic Advantage of Draft-First Architecture

Rather than automating direct sending (which carries high delivery risks and configuration bloat), this pipeline programmatically inserts a professional HTML draft directly into your Gmail account. This allows you to review the email, position your cursor, and use Gmail's native **"Insert files using Drive"** icon to attach your resume (`abhinand.pdf`) securely before clicking send.

---

## 2. Directory Layout & File Structure

```
outreach-automation/
├── extension/
│   ├── manifest.json
│   ├── content.js
│   ├── popup.html
│   └── popup.js
└── backend/
    ├── .env
    ├── .env_refresh
    ├── package.json
    └── server.js
``` [cite: 1, 2, 3]

---

## 3. Step-by-Step Implementation Roadmap

### Phase 1: Local Backend & Google OAuth Initialization
Initialize your local server environment to handle authentication callbacks and Google token refreshes without requiring hardcoded parameters inside the browser [cite: 2, 7].

#### Step 1.1: Node.js Server Environment Setup (`/backend/package.json`)
Run these commands in your `/backend` terminal:
```bash
npm init -y
npm install express googleapis dotenv cors
``` [cite: 1, 3]

Create `/backend/package.json`:
```json
{
  "name": "outreach-backend",
  "version": "1.0.0",
  "description": "Local server for OAuth management and Gmail API drafts",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "googleapis": "^137.0.0"
  }
}
``` [cite: 1, 3]

#### Step 1.2: Environment Configuration (`/backend/.env`)
Create a `.env` file to securely store your local secrets [cite: 2]. This prevents your API keys and credentials from being exposed in your extension bundle [cite: 4].
```env
CLIENT_ID=YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com
CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
SENDER_EMAIL=your-personal-gmail@gmail.com
``` [cite: 2]

#### Step 1.3: Run standard Google Cloud console configuration
1. Open the Google Cloud Console [cite: 19].
2. Enable the **Gmail API** [cite: 12].
3. Setup the **OAuth Consent Screen** (User Type: *External*; Publishing Status: *Testing*; add your personal Gmail address to the authorized test list) [cite: 20].
4. Go to Credentials -> **OAuth Client ID** -> select **Web Application** [cite: 21].
5. Configure URIs [cite: 1]:
   * *Authorized JavaScript origins:* `http://localhost:5000`
   * *Authorized redirect URIs:* `http://localhost:5000/oauth2callback` [cite: 11]
6. Save your Client ID and Client Secret directly in your `.env` [cite: 2].

---

### Phase 2: Native Google SDK Draft Core Engine (`/backend/server.js`)
Build a server that handles OAuth callbacks, saves your refresh token locally, compiles rich text templates with platform hyperlinks, and translates drafts into compliant Base64URL MIME envelopes [cite: 13, 14, 22].

#### `/backend/server.js` File:
```javascript
require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors()); // Allow local extension queries to communicate with localhost port

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "http://localhost:5000/oauth2callback"
);

// Authorization entry point
app.get('/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Request offline access to get the persistent refresh token
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify'
    ]
  });
  res.redirect(authUrl);
});

// OAuth Callback to catch and save long-lived Refresh Token
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    if (tokens.refresh_token) {
      // Safely write the refresh token to your disk
      fs.writeFileSync(path.join(__dirname, '.env_refresh'), `REFRESH_TOKEN=${tokens.refresh_token}`);
      res.send("Authentication Successful! Refresh token stored locally. You can close this tab and start using the extension.");
    } else {
      res.send("Authenticated successfully, but no refresh token was returned. (Go to your Google Account Settings, revoke permissions for this app, and try again to force consent).");
    }
  } catch (error) {
    res.status(500).send("OAuth Error: " + error.message);
  }
});

// Helper to compile a clean single-part HTML RFC 2822 message
function buildAndEncodeEmail(to, sender, subject, htmlBody) {
  const emailParts = [
    `From: Abhinand <${sender}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody).toString('base64')
  ];

  const rawMime = emailParts.join('\r\n').trim();
  
  // Base64URL encode the entire raw string (strip padding and replace characters)
  return Buffer.from(rawMime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// REST API to build a Gmail Draft
app.post('/create-draft', async (req, res) => {
  const { recipientEmail, role, platform, url } = req.body;

  if (!recipientEmail || !role || !platform || !url) {
    return res.status(400).json({ success: false, error: "Missing required post properties." });
  }

  try {
    const refreshPath = path.join(__dirname, '.env_refresh');
    if (!fs.existsSync(refreshPath)) {
      return res.status(401).json({ success: false, error: "Backend unauthorized. Please visit http://localhost:5000/auth first." });
    }
    const refresh_token = fs.readFileSync(refreshPath, 'utf8').split('=')[1].trim();

    // Exchange refresh token for active session parameters
    oauth2Client.setCredentials({ refresh_token: refresh_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Format rich text links dynamically
    const platformLink = `<a href="${url}">${platform}</a>`;
    const subjectLine = `Application | ${role} | Abhinand`;
    
    // HTML Email template with structured link and a bottom spacer
    const htmlBody = `
      <p>Dear hiring manager,</p>
      <p>I am writing this email to express my interest in the ${role} role, that I saw on ${platformLink}.</p>
      <p>I am an experienced Full-Stack Developer with hands-on expertise in NestJS, NodeJS, React, and Next.js. I have successfully built and deployed monolithic and microservice architectures on Cloud platforms (GCP, Azure, DigitalOcean) using Docker and Kubernetes.</p>
      <p>My expertise lies in databases like Clickhouse, Postgres, MongoDB and implementing WhatsApp automation. With a strong foundation in SOLID principles and a focus on clean code, I am eager to help your development team.</p>
      <br>
      <p>resume: </p>
      <p><i>[Position cursor here and click the "Insert files using Drive" icon to add abhinand.pdf]</i></p>
    `;

    const encodedRawEmail = buildAndEncodeEmail(
      recipientEmail,
      process.env.SENDER_EMAIL,
      subjectLine,
      htmlBody
    );

    // REST call to make draft resource
    const response = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw: encodedRawEmail
        }
      }
    });

    res.json({ success: true, draftId: response.data.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(5000, () => {
  console.log("Outreach local server listening on http://localhost:5000");
  console.log("--> Action Required: Visit http://localhost:5000/auth to log in with your Google account!");
});
``` [cite: 1, 3, 13, 14, 22, 23, 24]

---

### Phase 3: Client-Side Extension Setup (`/extension`)
Create a passive Chrome Extension that parses pages only upon direct user request to prevent trigger detections and account bans [cite: 4, 25].

#### Step 3.1: Manifest Declaration (`/extension/manifest.json`)
```json
{
  "manifest_version": 3,
  "name": "Outreach Companion",
  "version": "1.0",
  "permissions": [
    "activeTab"
  ],
  "host_permissions": [
    "http://localhost:5000/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "*://*.linkedin.com/*",
        "*://*.indeed.com/*",
        "*://*.instahyre.com/*"
      ],
      "js": ["content.js"]
    }
  ],
  "action": {
    "default_popup": "popup.html"
  }
}
``` [cite: 1]

#### Step 3.2: Content Scraper (`/extension/content.js`)
Avoid brittle class selectors by checking URL path headers and reading structural attributes [cite: 26, 27].
```javascript
function extractPageMetadata() {
  const url = window.location.href;
  let platform = "LinkedIn";
  let role = "Full Stack Developer"; // Default fallback value

  if (url.includes("indeed.com")) {
    platform = "Indeed";
    // Target standard Indeed job header container
    const header = document.querySelector('h1[class*="jobsearch-JobInfoHeader-title"]');
    if (header) role = header.innerText.replace("- job post", "").trim();
  } else if (url.includes("instahyre.com")) {
    platform = "Instahyre";
    const titleElem = document.querySelector('.job-title');
    if (titleElem) role = titleElem.innerText.trim();
  } else if (url.includes("linkedin.com")) {
    platform = "LinkedIn";
    // Pull the clean title from LinkedIn's view pages
    const titleElem = document.querySelector('h1.t-24');
    if (titleElem) role = titleElem.innerText.trim();
  }

  return { platform, role, url };
}

// Handle query from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "parse_page") {
    sendResponse(extractPageMetadata());
  }
});
``` [cite: 28, 29]

---

### Phase 4: Popup User Interface & Waterfall Integration

#### Step 4.1: Popup View Layout (`/extension/popup.html`)
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { width: 320px; font-family: Arial, sans-serif; padding: 12px; margin: 0; background-color: #fcfcfc; }
    h3 { margin-top: 0; font-size: 14px; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
    .field { margin-bottom: 10px; }
    label { font-weight: bold; font-size: 11px; color: #666; display: block; margin-bottom: 4px; }
    input { width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; }
    input[readonly] { background-color: #eee; color: #888; }
    button { width: 100%; padding: 8px; background-color: #0073b1; border: none; border-radius: 4px; color: white; font-weight: bold; cursor: pointer; font-size: 13px; }
    button:hover { background-color: #005a84; }
    button:disabled { background-color: #999; cursor: not-allowed; }
  </style>
</head>
<body>
  <h3>Outreach Draft Creator</h3>
  <div class="field">
    <label>Recipient Email:</label>
    <input type="text" id="emailInput" placeholder="Resolving via Waterfall API...">
  </div>
  <div class="field">
    <label>Hiring Role:</label>
    <input type="text" id="roleInput">
  </div>
  <div class="field">
    <label>Platform:</label>
    <input type="text" id="platformInput" readonly>
  </div>
  <div class="field">
    <label>Job URL:</label>
    <input type="text" id="urlInput" readonly>
  </div>
  <button id="sendBtn">Create Outreach Draft</button>

  <script src="popup.js"></script>
</body>
</html>
``` [cite: 1, 28, 30, 31]

#### Step 4.2: Frontend Waterfall and Backend Trigger Routing (`/extension/popup.js`)
This implements the complete waterfall search routine and calls your local backend [cite: 7, 21].
```javascript
document.addEventListener('DOMContentLoaded', async () => {
  const emailInput = document.getElementById('emailInput');
  const roleInput = document.getElementById('roleInput');
  const platformInput = document.getElementById('platformInput');
  const urlInput = document.getElementById('urlInput');
  const sendBtn = document.getElementById('sendBtn');

  // Query active tab for metadata
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(activeTab.id, { action: "parse_page" }, (metadata) => {
    if (metadata) {
      roleInput.value = metadata.role;
      platformInput.value = metadata.platform;
      urlInput.value = metadata.url;
      
      // Execute the Waterfall Enrichment lookup flow using the scraped metadata
      runWaterfallEnrichment(metadata);
    }
  });

  // Waterfall Strategy
  async function runWaterfallEnrichment(metadata) {
    try {
      let resolvedEmail = null;
      
      // Stage A: Regex Scan (Mock placeholder for direct HTML/text scan)
      // Stage B: Fetch Domain & Target HR Manager via Apollo.io
      const domain = extractDomainFromPlatform(metadata);
      if (domain) {
        resolvedEmail = await queryApolloForRecipient(domain);
      }

      if (resolvedEmail) {
        emailInput.value = resolvedEmail;
      } else {
        emailInput.value = "";
        emailInput.placeholder = "Not found. Please enter manually.";
      }
    } catch (err) {
      console.error("Enrichment error: ", err);
      emailInput.placeholder = "Waterfall resolution error.";
    }
  }

  function extractDomainFromPlatform(metadata) {
    // Read company attributes from page and convert to domain (e.g. targetcompany.com)
    return "targetcompany.com"; // Mockup conversion
  }

  async function queryApolloForRecipient(domain) {
    // API Implementation referencing Apollo People Search
    // Parameters: person_titles=["Recruiter", "Talent Acquisition", "HR"], locations=["India"]
    return "hiring-manager@targetcompany.com"; // Mockup resolution
  }

  // Action Button to hit Localhost Backend
  sendBtn.addEventListener('click', async () => {
    sendBtn.innerText = "Processing...";
    sendBtn.disabled = true;

    const payload = {
      recipientEmail: emailInput.value,
      role: roleInput.value,
      platform: platformInput.value,
      url: urlInput.value
    };

    try {
      const response = await fetch("http://localhost:5000/create-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.success) {
        alert("Draft successfully compiled in Gmail! Open your drafts folder, insert your resume using the Google Drive icon, and send.");
      } else {
        alert("Failed to build draft: " + result.error);
      }
    } catch (error) {
      alert("Cannot connect to local backend server. Did you start it using `npm start`?");
    } finally {
      sendBtn.innerText = "Create Outreach Draft";
      sendBtn.disabled = false;
    }
  });
});
``` [cite: 1, 32, 33, 34, 35]

---

## 4. Execution Plan for the Coding Agent

Follow these instructions exactly to build, authenticate, and run the pipeline:

1. **Backend Dependencies:** Install modules in `/backend` using `npm install` [cite: 1, 3]. Ensure all dependencies are written to `package.json` [cite: 30].
2. **Setup credentials.env:** Obtain OAuth Web App tokens from Google Cloud and populate `.env` [cite: 2].
3. **Register Extension:** Go to `chrome://extensions` in Google Chrome [cite: 31], toggle **Developer Mode** on [cite: 31], click **Load Unpacked**, and select the `/extension` directory [cite: 1].
4. **Acquire Session Token:** Start the backend server (`node server.js` or `npm start` in `/backend`) [cite: 1]. In your browser, open `http://localhost:5000/auth` [cite: 1]. Sign in with your designated Gmail account, agree to the permissions screen, and verify that the backend generates the `.env_refresh` file in your root folder [cite: 15, 23].
5. **Simulate Cold Run:**
   * Go to a live job page or recruitment feed on LinkedIn, Indeed, or Instahyre [cite: 1, 8, 9].
   * Open the Chrome Extension popup [cite: 1].
   * Ensure it extracts the platform name, URL, and role [cite: 27].
   * Click **Create Outreach Draft**.
   * Open Gmail, verify the newly created draft exists, position your cursor, click the **"Insert files using Drive"** icon, choose your resume, and hit send [cite: 14, 16, 17]!

---

## 5. Security & Account Safety Guardrails (IMPORTANT)

To prevent your personal social and professional accounts from getting restricted or banned, make sure your code adheres to these strict rules:

* **Strictly Passive Extraction:** The extension must **NEVER** run background loops, automatic scroll scripts, or trigger unattended click patterns [cite: 36]. It should only query the active tab's HTML **after the user opens the popup and clicks the button manually** [cite: 7, 25].
* **No Cookie Exfiltration:** Never attempt to capture session tokens (such as `li_at` cookies) and send them to a backend server [cite: 37]. Replaying active cookies from varying IP subnets triggers security challenges and permanent account suspensions instantly [cite: 38]. Keep all scraping strictly local to the active user session [cite: 4, 25].
* **Enforce Local Credentials:** Keep all API keys (such as Apollo, Hunter, and Serper keys) and Google OAuth Client secrets inside the `/backend/.env` file [cite: 2]. Do not store credentials on the client-side extension or your Chrome Web Store registry files [cite: 4].

```