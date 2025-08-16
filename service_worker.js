// Background service worker for FB Auto extension

// Installation handler
chrome.runtime.onInstalled.addListener((details) => {
  console.log("FB Auto installed:", details.reason);
  
  // Set up default storage
  chrome.storage.sync.get(["fbAutoOptions", "fbAutoCustomSettings"], (result) => {
    if (!result.fbAutoOptions) {
      const defaults = {
        prefix: "",
        emojiPool: "🙂,🔥,✅,🚀,✨,👍",
        emoMin: "2",
        emoMax: "3",
        timeFmt: "HHMMSS",
        contextOn: "true",
        reactMode: "RANDOM",
        scrollSpeed: "medium",
        delayMin: "20",
        delayMax: "30",
        typing: "true",
        rate5: "4",
        rate60: "40",
        rateSession: "60",
        coolSession: "30",
        failN: "5",
        coolFail: "20",
        seeMorePct: "20",
        singlePct: "0",
        authorCap: "2",
        pageCap: "20",
        pageCool: "60"
      };
      
      chrome.storage.sync.set({ fbAutoOptions: defaults });
    }
  });
  
  // Create context menu item
  chrome.contextMenus.create({
    id: "saveToFbAuto",
    title: "Save to FB Auto Links",
    contexts: ["link"]
  });
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "saveToFbAuto" && info.linkUrl) {
    chrome.storage.local.get("linkManager", ({ linkManager }) => {
      const lm = linkManager || { links: [], importantId: null };
      
      if (!lm.links.some(l => l.url === info.linkUrl)) {
        const id = crypto.randomUUID?.() || Date.now().toString(36);
        lm.links.push({ 
          id, 
          url: info.linkUrl, 
          createdAt: Date.now(), 
          usageCount: 0 
        });
        
        if (!lm.importantId) lm.importantId = id;
        
        chrome.storage.local.set({ linkManager: lm }, () => {
          console.log("Link saved:", info.linkUrl);
        });
      }
    });
  }
});

// Keep service worker alive
chrome.runtime.onStartup.addListener(() => {
  console.log("FB Auto service worker started");
});

// Periodic check (every 5 minutes)
chrome.alarms.create("keepAlive", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    console.log("FB Auto keep-alive check");
  }
});