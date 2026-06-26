const BACKEND_URL = "http://localhost:5000";

function setStatus(message, isError = false) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = isError ? "status error" : "status";
}

async function getActiveTab() {
  if (!chrome?.tabs?.query) {
    throw new Error("This extension needs the tabs permission.");
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function extractDetailsFromPage() {
  const tab = await getActiveTab();

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  const response = await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tab.id,
      { action: "extract_post_details" },
      (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result);
      }
    );
  });

  if (!response?.ok) {
    throw new Error("This page is not ready for extraction.");
  }

  return response.data;
}

async function pingBackend() {
  const response = await fetch(`${BACKEND_URL}/health`);
  if (!response.ok) {
    throw new Error("Backend is not reachable.");
  }
}

async function createDraft(payload) {
  const response = await fetch(`${BACKEND_URL}/create-draft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || "Draft creation failed.");
  }

  return data;
}

document.addEventListener("DOMContentLoaded", async () => {
  const createDraftBtn = document.getElementById("createDraftBtn");

  createDraftBtn.addEventListener("click", async () => {
    createDraftBtn.disabled = true;
    setStatus("Reading the active page...");

    try {
      const details = await extractDetailsFromPage();
      console.log('details',details)
      setStatus("Checking backend...");

      await pingBackend();

      const payload = {
        recipientEmail: (details.emails && details.emails[0]) || "",
        roleTitle: details.roleTitle || "",
        platform: details.platform || "",
        postUrl: details.url || "",
        postText: details.pageText || "",
        driveFileId: "1uJ5nXn-6rb3bAa-spUrP9i3VZW7KN5OY" // Pass your static resume's Google Drive File ID here
      };

      setStatus("Creating Gmail draft...");
      const result = await createDraft(payload);

      setStatus(`Draft created in Gmail${result.draftId ? ` (${result.draftId})` : ""}.`);
      alert('success')
    } catch (error) {
      const message = error instanceof Error ? error.message : "Draft creation failed.";
      alert(message)
      setStatus(message, true);
    } finally {
      createDraftBtn.disabled = false;
    }
  });
});
