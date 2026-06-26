function getPlatform(url) {
  if (url.includes("linkedin.com")) return "LinkedIn";
  if (url.includes("indeed.com")) return "Indeed";
  if (url.includes("instahyre.com")) return "Instahyre";
  return "Unknown";
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function extractEmails(text) {
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(matches.map((email) => email.trim()))];
}

function extractRoleTitle({ platform, title, text }) {
  const cleanedTitle = normalizeWhitespace(title || "");
  const patterns = [
    /(?:we're|we are|now|currently)\s+hiring\s+for\s+([^\n,.|]{3,120})/i,
    /(?:open(?:ing)?\s+for|role:\s*|position:\s*|job:\s*)([^\n,.|]{3,120})/i,
    /(?:looking for|hiring)\s+([^\n,.|]{3,120})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeWhitespace(match[1]);
  }

  if (platform === "LinkedIn") {
    const titleMatch = cleanedTitle.match(/^(.*?)(?:\s*[\-|•]\s*LinkedIn)?$/i);
    if (titleMatch?.[1]) return normalizeWhitespace(titleMatch[1]);
  }

  if (platform === "Indeed") {
    const titleMatch = cleanedTitle.match(/^(.*?)(?:\s*-\s*job post)?$/i);
    if (titleMatch?.[1]) return normalizeWhitespace(titleMatch[1]);
  }

  if (platform === "Instahyre" && cleanedTitle) {
    return cleanedTitle;
  }

  return cleanedTitle || "Role not detected";
}

function collectVisibleText() {
  const preferredNodes = [
    document.querySelector("main"),
    document.querySelector("article"),
    document.querySelector('[role="main"]'),
    document.body
  ].filter(Boolean);

  const parts = [];
  for (const node of preferredNodes) {
    const text = normalizeWhitespace(node.innerText || "");
    if (text) parts.push(text);
  }

  return normalizeWhitespace(parts.join("\n"));
}

function extractPostDetails() {
  const url = window.location.href;
  const platform = getPlatform(url);
  const pageTitle = normalizeWhitespace(document.title || "");
  const pageText = collectVisibleText();
  const emails = extractEmails(`${pageTitle}\n${pageText}`);
  const roleTitle = extractRoleTitle({
    platform,
    title: pageTitle,
    text: pageText
  });

  return {
    platform,
    url,
    title: pageTitle,
    roleTitle,
    emails,
    pageText: pageText.slice(0, 12000)
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action === "extract_post_details") {
    sendResponse({
      ok: true,
      data: extractPostDetails()
    });
  }
});
