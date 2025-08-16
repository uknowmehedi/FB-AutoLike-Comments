// ===== Utilities =====
const LS_LINKS = "linkManager";
const CUSTOM_SETTINGS_KEY = "fbAutoCustomSettings";
const DOT = document.getElementById("statusDot");
const STATUS = document.getElementById("statusText");

// Status indicator
function setStatus(kind) {
  DOT.classList.remove("running", "cooldown", "stopped");
  if (kind === "running") { 
    DOT.classList.add("running"); 
    STATUS.textContent = "Running"; 
  } else if (kind === "cooldown") { 
    DOT.classList.add("cooldown"); 
    STATUS.textContent = "Cooldown"; 
  } else { 
    DOT.classList.add("stopped"); 
    STATUS.textContent = "Stopped"; 
  }
}
setStatus("stopped");

// Tab management
function queryActiveTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      return;
    }
    cb(tabs?.[0]);
  });
}

// Link storage
async function getLinks() {
  try {
    const { linkManager } = await chrome.storage.local.get(LS_LINKS);
    return linkManager || { links: [], importantId: null, alwaysAttach: true, attachProbability: 40 };
  } catch (error) {
    console.error("Error getting links:", error);
    return { links: [], importantId: null, alwaysAttach: true, attachProbability: 40 };
  }
}

async function setLinks(lm) {
  try {
    await chrome.storage.local.set({ [LS_LINKS]: lm });
  } catch (error) {
    console.error("Error saving links:", error);
  }
}

// ===== Link Manager UI =====
async function renderLinks() {
  const box = document.getElementById("linksList");
  if (!box) return;
  
  try {
    const lm = await getLinks();
    box.innerHTML = "";
    
    if (!lm.links?.length) {
      box.innerHTML = `<div class="link-row"><div class="url">No links saved</div></div>`;
      return;
    }
    
    lm.links.forEach(l => {
      const row = document.createElement("div");
      row.className = "link-row";
      row.innerHTML = `
        <div class="url" title="${l.url}">${l.url}</div>
        <div class="row">
          <button class="btn tiny ${lm.importantId === l.id ? 'primary' : ''}" data-act="imp" data-id="${l.id}">
            ${lm.importantId === l.id ? '★ Important' : '☆ Make important'}
          </button>
          <button class="btn tiny danger" data-act="rm" data-id="${l.id}">Remove</button>
        </div>
      `;
      box.appendChild(row);
    });
    
    // Attach handlers
    box.querySelectorAll("button[data-act]").forEach(btn => {
      btn.onclick = async () => {
        const act = btn.dataset.act, id = btn.dataset.id;
        const lm2 = await getLinks();
        
        if (act === "imp") {
          lm2.importantId = id; 
          await setLinks(lm2); 
          renderLinks();
        } else if (act === "rm") {
          if (lm2.importantId === id) {
            openNewImportantModal(async (newUrl) => {
              const newId = crypto.randomUUID?.() || Date.now().toString(36);
              lm2.links.push({ id: newId, url: newUrl, createdAt: Date.now(), usageCount: 0 });
              lm2.importantId = newId;
              lm2.links = lm2.links.filter(x => x.id !== id);
              await setLinks(lm2); 
              renderLinks();
            });
          } else {
            lm2.links = lm2.links.filter(x => x.id !== id);
            await setLinks(lm2); 
            renderLinks();
          }
        }
      };
    });

    // Update attach settings
    const alwaysAttach = document.getElementById("alwaysAttach");
    const attachProb = document.getElementById("attachProb");
    if (alwaysAttach && attachProb) {
      alwaysAttach.checked = lm.alwaysAttach;
      attachProb.value = lm.attachProbability ?? 40;
      attachProb.disabled = lm.alwaysAttach;
    }
  } catch (error) {
    console.error("Error rendering links:", error);
  }
}

function openNewImportantModal(onOk) {
  const modal = document.getElementById("newImpModal");
  const inp = document.getElementById("newImpInput");
  const ok = document.getElementById("newImpOk");
  const cancel = document.getElementById("newImpCancel");
  
  if (!modal || !inp || !ok || !cancel) return;
  
  modal.style.display = "flex";
  inp.value = "";
  
  const close = () => { 
    modal.style.display = "none"; 
    ok.onclick = null; 
    cancel.onclick = null; 
  };
  
  ok.onclick = () => {
    const u = (inp.value || "").trim();
    if (!/^https?:\/\//i.test(u)) {
      showStatusMessage("Valid URL required (https://...)", "error");
      return;
    }
    onOk(u); 
    close();
  };
  
  cancel.onclick = close;
}

// ===== Settings Management =====
async function saveCustomSettings() {
  try {
    const settings = {
      version: 2,
      commentBuilder: {
        prefix: document.getElementById("prefix").value,
        emojiPool: document.getElementById("emojiPool").value,
        emoMin: document.getElementById("emoMin").value,
        emoMax: document.getElementById("emoMax").value,
        timeFmt: document.getElementById("timeFmt").value,
        contextOn: document.getElementById("contextOn").value
      },
      reaction: {
        reactMode: document.getElementById("reactMode").value,
        scrollSpeed: document.getElementById("scrollSpeed").value,
        delayMin: document.getElementById("delayMin").value,
        delayMax: document.getElementById("delayMax").value,
        typing: document.getElementById("typing").value
      },
      rateMix: {
        rate5: document.getElementById("rate5").value,
        rate60: document.getElementById("rate60").value,
        rateSession: document.getElementById("rateSession").value,
        coolSession: document.getElementById("coolSession").value,
        failN: document.getElementById("failN").value,
        coolFail: document.getElementById("coolFail").value,
        seeMorePct: document.getElementById("seeMorePct").value,
        singlePct: document.getElementById("singlePct").value,
        authorCap: document.getElementById("authorCap").value,
        pageCap: document.getElementById("pageCap").value,
        pageCool: document.getElementById("pageCool").value
      },
      linkManager: {
        alwaysAttach: document.getElementById("alwaysAttach").checked,
        attachProbability: document.getElementById("attachProb").value
      }
    };

    await chrome.storage.sync.set({ [CUSTOM_SETTINGS_KEY]: settings });
    showStatusMessage("Settings saved successfully!", "success");
    setTimeout(() => showStatusMessage(""), 2000);
  } catch (error) {
    console.error("Error saving settings:", error);
    showStatusMessage("Failed to save settings", "error");
  }
}

async function loadCustomSettings() {
  try {
    const { fbAutoCustomSettings } = await chrome.storage.sync.get(CUSTOM_SETTINGS_KEY);
    if (fbAutoCustomSettings) {
      // Comment Builder
      if (fbAutoCustomSettings.commentBuilder) {
        const cb = fbAutoCustomSettings.commentBuilder;
        setValue("prefix", cb.prefix);
        setValue("emojiPool", cb.emojiPool, "🙂,🔥,✅,🚀,✨,👍");
        setValue("emoMin", cb.emoMin, "2");
        setValue("emoMax", cb.emoMax, "3");
        setValue("timeFmt", cb.timeFmt, "HHMMSS");
        setValue("contextOn", cb.contextOn, "true");
      }
      
      // Reaction
      if (fbAutoCustomSettings.reaction) {
        const r = fbAutoCustomSettings.reaction;
        setValue("reactMode", r.reactMode, "RANDOM");
        setValue("scrollSpeed", r.scrollSpeed, "medium");
        setValue("delayMin", r.delayMin, "20");
        setValue("delayMax", r.delayMax, "30");
        setValue("typing", r.typing, "true");
      }
      
      // Rate & Mix
      if (fbAutoCustomSettings.rateMix) {
        const rm = fbAutoCustomSettings.rateMix;
        setValue("rate5", rm.rate5, "4");
        setValue("rate60", rm.rate60, "40");
        setValue("rateSession", rm.rateSession, "60");
        setValue("coolSession", rm.coolSession, "30");
        setValue("failN", rm.failN, "5");
        setValue("coolFail", rm.coolFail, "20");
        setValue("seeMorePct", rm.seeMorePct, "20");
        setValue("singlePct", rm.singlePct, "0");
        setValue("authorCap", rm.authorCap, "2");
        setValue("pageCap", rm.pageCap, "20");
        setValue("pageCool", rm.pageCool, "60");
      }

      // Link Manager
      if (fbAutoCustomSettings.linkManager) {
        const lm = fbAutoCustomSettings.linkManager;
        setCheckbox("alwaysAttach", lm.alwaysAttach !== false);
        setValue("attachProb", lm.attachProbability, "40");
      }
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
}

function setValue(id, value, defaultValue = "") {
  const el = document.getElementById(id);
  if (el) el.value = value !== undefined ? value : defaultValue;
}

function setCheckbox(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = !!checked;
}

function showStatusMessage(message, type = "info") {
  const statusEl = document.getElementById("saveStatus");
  if (!statusEl) return;
  
  statusEl.textContent = message;
  statusEl.className = `status-message ${type}`;
}

// ===== Event Listeners =====
function setupEventListeners() {
  // Save link
  document.getElementById("saveLink")?.addEventListener("click", async () => {
    const urlInput = document.getElementById("linkInput");
    if (!urlInput) return;
    
    const url = (urlInput.value || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      showStatusMessage("Please enter a valid URL (https://...)", "error");
      return;
    }
    
    try {
      const lm = await getLinks();
      if (!lm.links.find(x => x.url === url)) {
        const id = crypto.randomUUID?.() || Date.now().toString(36);
        lm.links.push({ id, url, createdAt: Date.now(), usageCount: 0 });
        if (!lm.importantId) lm.importantId = id;
        await setLinks(lm);
        urlInput.value = "";
        showStatusMessage("Link saved", "success");
        setTimeout(() => showStatusMessage(""), 2000);
      } else {
        showStatusMessage("Link already exists", "error");
        setTimeout(() => showStatusMessage(""), 2000);
      }
      await renderLinks();
    } catch (error) {
      console.error("Error saving link:", error);
      showStatusMessage("Error saving link", "error");
    }
  });

  // Always attach checkbox
  document.getElementById("alwaysAttach")?.addEventListener("change", async (e) => {
    try {
      const lm = await getLinks();
      lm.alwaysAttach = e.target.checked;
      await setLinks(lm);
      const attachProb = document.getElementById("attachProb");
      if (attachProb) attachProb.disabled = e.target.checked;
      renderLinks();
    } catch (error) {
      console.error("Error updating attach setting:", error);
    }
  });

  // Attach probability
  document.getElementById("attachProb")?.addEventListener("input", async (e) => {
    try {
      const v = Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10)));
      const lm = await getLinks();
      lm.attachProbability = v;
      await setLinks(lm);
    } catch (error) {
      console.error("Error updating attach probability:", error);
    }
  });

  // Save settings button
  document.getElementById("saveSettingsBtn")?.addEventListener("click", saveCustomSettings);

  // Reset button
  document.getElementById("resetBtn")?.addEventListener("click", async () => {
    try {
      await chrome.storage.sync.remove("fbAutoOptions");
      await chrome.storage.sync.remove(CUSTOM_SETTINGS_KEY);
      await loadOptions();
      showStatusMessage("Reset to defaults", "success");
      setTimeout(() => showStatusMessage(""), 2000);
    } catch (error) {
      console.error("Error resetting settings:", error);
      showStatusMessage("Error resetting", "error");
    }
  });

  // Start/Stop buttons
  document.getElementById("startBtn")?.addEventListener("click", async () => {
    try {
      const opts = getOptionsFromUI();
      await saveCustomSettings();
      queryActiveTab(tab => {
        if (!tab?.id) {
          showStatusMessage("No active tab found", "error");
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: "FB_AUTO_START_INLINE", opts }, resp => {
          setStatus("running");
        });
      });
    } catch (error) {
      console.error("Error starting:", error);
      showStatusMessage("Error starting", "error");
    }
  });

  document.getElementById("stopBtn")?.addEventListener("click", async () => {
    queryActiveTab(tab => {
      if (!tab?.id) return;
      chrome.tabs.sendMessage(tab.id, { type: "FB_AUTO_STOP" }, resp => {
        setStatus("stopped");
      });
    });
  });

  // Scope chips
  document.getElementById("scopeInline")?.addEventListener("click", () => {
    document.getElementById("scopeInline")?.classList.add("active");
    document.getElementById("scopeFeed")?.classList.remove("active");
  });
  
  document.getElementById("scopeFeed")?.addEventListener("click", () => {
    document.getElementById("scopeFeed")?.classList.add("active");
    document.getElementById("scopeInline")?.classList.remove("active");
  });

  // Tab navigation
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      
      btn.classList.add("active");
      const tabId = `${btn.dataset.tab}-tab`;
      document.getElementById(tabId)?.classList.add("active");
    });
  });
}

// ===== Initialization =====
async function loadOptions() {
  try {
    const { fbAutoOptions } = await chrome.storage.sync.get("fbAutoOptions");
    if (fbAutoOptions) {
      const fields = [
        "prefix", "emojiPool", "emoMin", "emoMax", "timeFmt", "contextOn",
        "reactMode", "scrollSpeed", "delayMin", "delayMax", "typing",
        "rate5", "rate60", "rateSession", "coolSession", "failN", "coolFail",
        "seeMorePct", "singlePct", "authorCap", "pageCap", "pageCool"
      ];
      
      fields.forEach(id => {
        const el = document.getElementById(id);
        if (el && fbAutoOptions[id] != null) el.value = fbAutoOptions[id];
      });
    }
    await renderLinks();
    await loadCustomSettings();
  } catch (error) {
    console.error("Error loading options:", error);
  }
}

function getOptionsFromUI() {
  const o = {};
  const fields = [
    "prefix", "emojiPool", "emoMin", "emoMax", "timeFmt", "contextOn",
    "reactMode", "scrollSpeed", "delayMin", "delayMax", "typing",
    "rate5", "rate60", "rateSession", "coolSession", "failN", "coolFail",
    "seeMorePct", "singlePct", "authorCap", "pageCap", "pageCool"
  ];
  
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) o[id] = el.value;
  });
  
  return o;
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  loadOptions();
  
  // Check if extension is running in current tab
  queryActiveTab(tab => {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "FB_AUTO_STATUS" }, resp => {
      if (chrome.runtime.lastError) return;
      if (resp?.running) setStatus("running");
    });
  });
});