function getPlatform(url) {
  if (url.includes("linkedin.com")) return "LinkedIn";
  if (url.includes("indeed.com")) return "Indeed";
  if (url.includes("instahyre.com")) return "Instahyre";
  return "Unknown";
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeForSearch(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmails(text) {
  const normalized = normalizeForSearch(text);
  const matches =
    normalized.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(matches.map((email) => email.trim()))];
}

function extractMailtoEmails() {
  const anchors = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
  return anchors
    .map((anchor) => {
      const href = anchor.getAttribute("href") || "";
      const email = href.replace(/^mailto:/i, "").split("?")[0];
      return normalizeForSearch(email);
    })
    .filter(Boolean);
}

function stripPageNoise(value) {
  return normalizeWhitespace(
    String(value || "")
      .replace(
        /\s+(?:Location|Company|Experience|Posted|Feed post|Apply|Applicants?|Job|Hiring)\b.*$/i,
        ""
      )
      .replace(/[\u{1F300}-\u{1FAFF}].*$/u, "")
  );
}

function trimLinkedInFooter(text) {
  const footerMarkers = [
    "About Accessibility Help Center",
    "Privacy & Terms",
    "Ad Choices",
    "Advertising Business Services"
  ];

  const normalized = String(text || "");
  let cutIndex = -1;
  for (const marker of footerMarkers) {
    const idx = normalized.indexOf(marker);
    if (idx !== -1 && (cutIndex === -1 || idx < cutIndex)) {
      cutIndex = idx;
    }
  }

  if (cutIndex > 0) {
    return normalizeWhitespace(normalized.slice(0, cutIndex));
  }

  return normalizeWhitespace(normalized);
}

function extractRoleTitle({ platform, title, text }) {
  const cleanedTitle = normalizeWhitespace(title || "");
  const patterns = [
    /(?:position|role|opening)\s*[:\-]\s*([^\n,.|]{3,120})/i,
    /(?:we're|we are|now|currently)\s+hiring\s+for\s+([^\n,.|]{3,120})/i,
    /(?:open(?:ing)?\s+for|role:\s*|position:\s*|job:\s*)([^\n,.|]{3,120})/i,
    /(?:looking for|hiring)\s+([^\n,.|]{3,120})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return stripPageNoise(match[1]);
  }

  if (platform === "LinkedIn") {
    const titleMatch = cleanedTitle.match(/^(.*?)(?:\s*[\-|•]\s*LinkedIn)?$/i);
    if (titleMatch?.[1]) return stripPageNoise(titleMatch[1]);
  }

  if (platform === "Indeed") {
    const titleMatch = cleanedTitle.match(/^(.*?)(?:\s*-\s*job post)?$/i);
    if (titleMatch?.[1]) return stripPageNoise(titleMatch[1]);
  }

  if (platform === "Instahyre" && cleanedTitle) {
    return stripPageNoise(cleanedTitle);
  }

  const titleSegments = cleanedTitle
    .split(/[|•\-–—]/g)
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean);
  const keywordSegments = titleSegments.filter((segment) =>
    /(developer|engineer|designer|manager|analyst|architect|lead|full stack|frontend|backend|qa|devops|software)/i.test(segment)
  );

  if (keywordSegments.length > 0) {
    return stripPageNoise(keywordSegments[0]);
  }

  if (titleSegments.length > 0) {
    return stripPageNoise(titleSegments[0]);
  }

  return stripPageNoise(cleanedTitle) || "Role not detected";
}

function collectVisibleText() {
  const preferredNodes = [
    document.querySelector("article"),
    document.querySelector('[role="main"]'),
    document.querySelector("main"),
    document.body
  ].filter(Boolean);

  const parts = [];
  const seen = new Set();
  for (const node of preferredNodes) {
    const text = normalizeForSearch(node.innerText || "");
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
  }

  const primary = parts[0] || "";
  return trimLinkedInFooter(primary);
}

function extractPostDetails() {
  const url = window.location.href;
  const platform = getPlatform(url);
  const pageTitle = normalizeForSearch(document.title || "");
  const pageText = platform === "LinkedIn" ? trimLinkedInFooter(collectVisibleText()) : collectVisibleText();
  const emails = [...extractEmails(`${pageTitle}\n${pageText}`), ...extractMailtoEmails()];
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
