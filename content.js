/***** FB Auto • React + Context Comment (Inline Only)
 *  - Human-like scroll
 *  - Read (≤30s) → understand (sentiment/topic)
 *  - Reaction (no Angry)
 *  - Comment (template + link + 2–3 emoji + time)
 *  - Skip if comments off
 *  - Close/Esc composer after submit
 *  - Rate limit + cooldown + behavior mix
 *  - Multi-tab: state is per content-script instance
*****/

// ===== State =====
const state = {
  running: false,
  actionsDone: 0,
  fails: 0,
  opts: null,
  processedIds: new Set(),
  lastAuthorId: null,
  sameAuthorCount: 0,
  samePageCount: 0,
  pageKey: null // per route
};

// ===== Utils =====
const log = (...a) => console.log("[FB-AUTO]", ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pad2 = n => String(n).padStart(2,'0');
const nowHHMMSS = (fmt="HHMMSS") => {
  const d = new Date(), h = pad2(d.getHours()), m = pad2(d.getMinutes()), s = pad2(d.getSeconds());
  return fmt === "HH:MM:SS" ? `${h}:${m}:${s}` : `${h}${m}${s}`;
};
const randInt = (a,b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const pickN = (arr, n) => {
  const a = [...arr], out = [];
  for (let i = 0; i < Math.min(n, a.length); i++) {
    out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
  }
  return out;
};

// ===== Human-like scroll =====
async function autoScrollStep(speed) {
  const cfg = {
    slow:   { px: [220, 360], wait: [900, 1500] },
    medium: { px: [320, 520], wait: [650, 1100] },
    fast:   { px: [420, 720], wait: [380, 750] }
  }[speed || "medium"];
  
  window.scrollBy({ top: randInt(cfg.px[0], cfg.px[1]), behavior: "smooth" });
  await sleep(randInt(cfg.wait[0], cfg.wait[1]));
}

// ===== Article discovery (inline) =====
function visibleArticles(limit = 3) {
  const arr = [];
  const vpH = window.innerHeight;
  // More robust selector for Facebook's dynamic content
  const nodes = document.querySelectorAll("div[role='article'], article, [data-pagelet*='Feed'], [id*='substream'] > div > div");
  
  for (const n of nodes) {
    if (!n || !n.getBoundingClientRect) continue;
    
    const r = n.getBoundingClientRect();
    if (r.top > 0 && r.top < vpH * 0.85 && r.width > 100) {
      const id = n.getAttribute("data-ft") || n.getAttribute("aria-posinset") || 
                (n.innerText?.slice(0, 80) + "|" + Math.round(r.top));
      if (!state.processedIds.has(id)) { 
        arr.push({ node: n, id }); 
        if (arr.length >= limit) break;
      }
    }
  }
  return arr;
}

// ===== Extract text & author/page heuristics =====
function extractPostText(article) {
  const bits = [];
  // More comprehensive text extraction
  article.querySelectorAll("div[dir='auto']:not([role='button']), span[dir='auto'], p, h1, h2, h3").forEach(el => {
    const t = (el.innerText || "").trim();
    if (t && !bits.includes(t)) bits.push(t);
  });
  return bits.join(" ").replace(/\s+/g, " ").trim().slice(0, 1000);
}

function extractAuthorKey(article) {
  // More reliable author detection
  const el = article.querySelector("h2 a[role='link'], strong a[role='link'], a[href*='/user/'], a[href*='/profile.php']");
  const href = el?.getAttribute?.("href") || "";
  return href || (el?.innerText || "");
}

// ===== Read-time (≤30s) =====
function estimateReadTimeMs(text) {
  const len = (text || "").length;
  const base = 3000; // 3s
  const per120 = Math.ceil(len / 120) * 2000; // +2s per 120 chars
  return Math.min(30000, base + per120);
}

async function readPostPause(article, text) {
  const ms = estimateReadTimeMs(text);
  article.scrollIntoView({ behavior: "smooth", block: "center" });
  const steps = Math.max(2, Math.round(ms / 1500));
  for (let i = 0; i < steps; i++) await sleep(1200 + Math.random() * 600);
}

// ===== Sentiment/topic detection =====
function sentimentScore(text) {
  const t = (text || "").toLowerCase();
  const pos = ["congrats", "congrat", "great", "awesome", "amazing", "love", "proud", "launch", "win", "promotion", "milestone", "success"];
  const neg = ["sad", "sorry", "loss", "issue", "problem", "bug", "down", "concern", "frustrat", "heartbroken"];
  let s = 0;
  pos.forEach(k => t.includes(k) && (s += 1));
  neg.forEach(k => t.includes(k) && (s -= 1));
  return s;
}

function detectTopic(text) {
  const t = (text || "").toLowerCase();
  if (/hiring|we are hiring|apply|job|career|opening|recruit/.test(t)) return "hiring";
  if (/launch|released|rolling out|now live|new feature|v\d/.test(t)) return "launch";
  if (/tips|guide|how to|lesson|thread|steps|tutorial|checklist/.test(t)) return "tips";
  if (/\?|what do you think|curious|thoughts/.test(t)) return "question";
  if (/event|webinar|conference|workshop/.test(t)) return "event";
  if (/update|changelog|improvement|fix|patch/.test(t)) return "update";
  if (/thanks|gratitude/.test(t)) return "congrats";
  if (/insight|perspective/.test(t)) return "insight";
  if (/help|support/.test(t)) return "support";
  return "general";
}

function chooseTemplateCategory(text) {
  const s = sentimentScore(text), t = detectTopic(text);
  if (s < 0) return "empathy";
  if (s > 0) {
    if (t === "launch") return "launch";
    if (t === "hiring") return "hiring";
    if (t === "update") return "update";
    if (t === "congrats") return "congrats";
    return "positive";
  }
  if (["tips", "question", "event", "insight", "support"].includes(t)) return t;
  return "general";
}

// ===== Reaction decision (No Angry) =====
function decideReactionByContext(text, forced) {
  if (forced && forced !== "RANDOM") return forced; // fixed mode
  const sent = sentimentScore(text);
  const topic = detectTopic(text);
  let weights = { Like: 1, Love: 1, Care: 1, Haha: 1, Wow: 1, Sad: 1 };
  
  if (sent < 0) {
    weights = { Like: 1, Love: 0, Care: 5, Haha: 0, Wow: 1, Sad: 4 };
  } else if (sent > 0) {
    if (topic === "launch" || topic === "update") {
      weights = { Like: 2, Love: 4, Care: 1, Haha: 1, Wow: 3, Sad: 0 };
    } else if (topic === "hiring") {
      weights = { Like: 3, Love: 2, Care: 1, Haha: 0, Wow: 2, Sad: 0 };
    } else {
      weights = { Like: 3, Love: 3, Care: 1, Haha: 1, Wow: 2, Sad: 0 };
    }
  } else {
    if (topic === "tips" || topic === "insight") {
      weights = { Like: 4, Love: 2, Care: 0, Haha: 1, Wow: 2, Sad: 0 };
    } else if (topic === "question") {
      weights = { Like: 4, Love: 1, Care: 0, Haha: 0, Wow: 2, Sad: 0 };
    } else {
      weights = { Like: 3, Love: 2, Care: 0, Haha: 1, Wow: 1, Sad: 0 };
    }
  }
  
  const pool = [];
  Object.entries(weights).forEach(([k, v]) => {
    for (let i = 0; i < v; i++) pool.push(k);
  });
  
  return pool[Math.floor(Math.random() * pool.length)] || "Like";
}

// ===== Reaction apply (inline) =====
async function reactOnPost(article, reaction) {
  // More reliable like button detection
  let likeBtn = article.querySelector([
    "div[aria-label='Like'][role='button']",
    "div[aria-label*='Like this'][role='button']",
    "div[role='button'][aria-label*='Like']",
    "div[aria-label='Like']",
    "[aria-label='Like']"
  ].join(","));
  
  if (!likeBtn) {
    // Fallback: try to find by SVG path
    likeBtn = article.querySelector("svg[aria-label='Like']")?.closest("[role='button']");
  }
  
  if (!likeBtn) throw new Error("Like button not found");

  // Simulate mouse events more realistically
  const mouseEvents = ["mouseover", "mouseenter", "mousemove"];
  for (const type of mouseEvents) {
    likeBtn.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window
    }));
    await sleep(200 + Math.random() * 300);
  }

  await sleep(800 + Math.random() * 500);

  // Improved reaction picker detection
  const tgt = reaction.toLowerCase();
  const picker = document.querySelector([
    "div[role='menu']",
    "div[role='dialog']",
    "div[aria-label='Reactions']",
    "div[data-pagelet='root'] > div > div:nth-child(2)"
  ].join(","));
  
  if (picker) {
    const pickerBtns = Array.from(picker.querySelectorAll("div[role='button']"));
    const pickerBtn = pickerBtns.find(b => {
      const al = (b.getAttribute('aria-label') || "").toLowerCase();
      const tt = (b.textContent || "").toLowerCase();
      return al.includes(tgt) || tt.includes(tgt);
    });

    if (pickerBtn) {
      pickerBtn.click();
      await sleep(300 + Math.random() * 200);
      return { reaction, mode: "picker" };
    }
  }

  // Fallback to simple like
  likeBtn.click();
  await sleep(300 + Math.random() * 200);
  return { reaction: "Like (fallback)", mode: "fallback" };
}

// ===== Templates (6000 JSON loaded once) =====
let TEMPLATE_PACK = null;
async function loadTemplatesOnce() {
  if (TEMPLATE_PACK) return TEMPLATE_PACK;
  try {
    const url = chrome.runtime.getURL("assets/comment_templates_6000.json");
    const res = await fetch(url);
    TEMPLATE_PACK = await res.json();
    return TEMPLATE_PACK;
  } catch (error) {
    console.error("Error loading templates:", error);
    return { general: ["{LINK} {EMOJI} {TIME}"] };
  }
}

async function pickTemplateFromPack(category) {
  try {
    const pack = await loadTemplatesOnce();
    const arr = pack?.[category] || pack?.general || [];
    if (!arr.length) return "{LINK} {EMOJI} {TIME}";
    return pick(arr);
  } catch (error) {
    console.error("Error picking template:", error);
    return "{LINK} {EMOJI} {TIME}";
  }
}

// ===== Link selection =====
async function getActiveLinkForComment() {
  try {
    const { linkManager } = await chrome.storage.local.get("linkManager");
    const lm = linkManager || {};
    if (!lm.links || !lm.links.length) return "";
    
    const imp = lm.links.find(l => l.id === lm.importantId) || lm.links[0];
    const url = imp?.url || "";
    
    if (lm.alwaysAttach) return url;
    const p = (lm.attachProbability ?? 0) / 100;
    return Math.random() < p ? url : "";
  } catch (error) {
    console.error("Error getting active link:", error);
    return "";
  }
}

// ===== Composer (inline) =====
function findInlineComposer(article) {
  // prioritise inside the article
  let ed = article.querySelector("[contenteditable='true'][role='textbox'][data-lexical-editor], [contenteditable='true'][role='textbox']");
  if (ed) return ed;
  // generic fallback in viewport
  ed = document.querySelector("[contenteditable='true'][role='textbox'][data-lexical-editor], [contenteditable='true'][role='textbox']");
  return ed;
}

function isCommentEnabled(article) {
  // if no composer hints exist
  const txt = article.innerText || "";
  if (/comments?\s+(are\s+)?turned\s+off/i.test(txt)) return false;
  
  const disabledEl = article.querySelector("[contenteditable='true'][aria-disabled='true']");
  if (disabledEl) return false;
  
  // heuristics: if we can click in comment area later; return true to try
  return true;
}

async function openInlineCommentArea(article) {
  // try clicking "Write a comment" area if visible
  const hint = Array.from(article.querySelectorAll("div[role='button'], span")).find(el => {
    const t = (el.innerText || "").toLowerCase();
    return /write a comment|comment/i.test(t);
  });
  
  if (hint) {
    hint.scrollIntoView({ behavior: "smooth", block: "center" });
    hint.click();
    await sleep(300);
  }
}

async function typeLikeHuman(editor, text, typingOn) {
  if (!editor) return;
  
  try {
    editor.focus();
    
    if (!typingOn) {
      if (document.execCommand) {
        document.execCommand("insertText", false, text);
      } else {
        editor.textContent = (editor.textContent || "") + text;
      }
    } else {
      for (const ch of text) {
        if (document.execCommand) {
          document.execCommand("insertText", false, ch);
        } else {
          editor.textContent = (editor.textContent || "") + ch;
        }
        
        await sleep(randInt(40, 120));
        
        if (Math.random() < 0.05) {
          if (document.execCommand) {
            document.execCommand("delete", false, null);
          } else {
            editor.textContent = editor.textContent.slice(0, -1);
          }
          
          await sleep(randInt(60, 140));
          
          if (document.execCommand) {
            document.execCommand("insertText", false, ch);
          } else {
            editor.textContent = (editor.textContent || "") + ch;
          }
        }
      }
    }
    
    await sleep(randInt(250, 600));
  } catch (error) {
    console.error("Error typing:", error);
  }
}

async function submitComment(editor) {
  if (!editor) return;
  
  try {
    const ev = new KeyboardEvent('keydown', { 
      key: 'Enter', 
      code: 'Enter', 
      keyCode: 13, 
      which: 13, 
      bubbles: true 
    });
    editor.dispatchEvent(ev);
    await sleep(400);
  } catch (error) {
    console.error("Error submitting comment:", error);
  }
}

async function closeComposer() {
  try {
    // try ESC to close any inline quick reply/popover
    document.dispatchEvent(new KeyboardEvent('keydown', { 
      key: 'Escape', 
      code: 'Escape', 
      keyCode: 27, 
      which: 27, 
      bubbles: true 
    }));
    await sleep(150);
    
    // blur active element
    if (document.activeElement) document.activeElement.blur();
  } catch (error) {
    console.error("Error closing composer:", error);
  }
}

// ===== Build comment =====
async function buildContextCommentFor(text, opts) {
  try {
    const category = opts?.contextOn === "true" ? chooseTemplateCategory(text) : "general";
    let tmpl = await pickTemplateFromPack(category);

    const link = await getActiveLinkForComment();
    const pool = (opts?.emojiPool || "🙂,🔥,✅,🚀,✨,👍").split(",").map(s => s.trim()).filter(Boolean);
    const n = randInt(
      Math.max(1, parseInt(opts?.emoMin || "2", 10)),
      Math.max(1, parseInt(opts?.emoMax || "3", 10))
    );
    const emojiStr = pickN(pool, n).join(" ");
    const time = nowHHMMSS(opts?.timeFmt || "HHMMSS");
    const prefix = (opts?.prefix || "").trim();

    let out = tmpl.replace("{LINK}", link || "").replace("{EMOJI}", emojiStr).replace("{TIME}", time);
    out = out.replace(/\s+/g, " ").trim();
    if (prefix) out = `${prefix} ${out}`.trim();
    return out;
  } catch (error) {
    console.error("Error building comment:", error);
    return "{LINK} {EMOJI} {TIME}";
  }
}

// ===== Rate limit & mix =====
const counters = {
  window5: [], // timestamps
  window60: [],
};

function pruneCounters() {
  const now = Date.now();
  counters.window5 = counters.window5.filter(t => now - t < 5 * 60 * 1000);
  counters.window60 = counters.window60.filter(t => now - t < 60 * 60 * 1000);
}

function recordAction() {
  const now = Date.now();
  counters.window5.push(now); 
  counters.window60.push(now);
}

function underLimits(opts) {
  pruneCounters();
  const max5 = parseInt(opts.rate5 || "4", 10);
  const max60 = parseInt(opts.rate60 || "40", 10);
  const maxSess = parseInt(opts.rateSession || "60", 10);
  
  if (counters.window5.length >= max5) return { ok: false, reason: "5m cap" };
  if (counters.window60.length >= max60) return { ok: false, reason: "60m cap" };
  if (state.actionsDone >= maxSess) return { ok: false, reason: "session cap" };
  
  return { ok: true };
}

async function cooldown(ms, label) {
  log("Cooldown:", label, ms, "ms");
  const step = 1000;
  let left = ms;
  
  while (state.running && left > 0) { 
    await sleep(step); 
    left -= step; 
  }
}

// Helper functions
function isElementVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const rect = el.getBoundingClientRect();
  const vpH = window.innerHeight;
  return rect.top > 0 && rect.top < vpH * 0.85 && rect.width > 0;
}

function getCurrentPageKey() {
  const path = location.pathname.split("/");
  if (path[1] === "groups") return `group-${path[2] || "unknown"}`;
  if (path[1] === "pages") return `page-${path[2] || "unknown"}`;
  return path[1] || "feed";
}

// ===== Main per-post routine =====
async function processOnePost(article) {
  if (!state.running || !article?.node) return;

  try {
    // Improved visibility check
    if (!isElementVisible(article.node)) {
      log("Post not visible, skipping");
      return;
    }

    // Author/page caps
    const authorKey = extractAuthorKey(article.node);
    if (authorKey && authorKey === state.lastAuthorId) {
      state.sameAuthorCount++;
    } else {
      state.lastAuthorId = authorKey;
      state.sameAuthorCount = 1;
    }
    
    const authorCap = parseInt(state.opts.authorCap || "2", 10);
    if (state.sameAuthorCount > authorCap) {
      log("Skip: same author cap");
      return;
    }

    // page cap heuristic (route key)
    const pageKey = getCurrentPageKey();
    if (state.pageKey === pageKey) {
      state.samePageCount++;
    } else {
      state.pageKey = pageKey;
      state.samePageCount = 1;
    }
    
    const pageCap = parseInt(state.opts.pageCap || "20", 10);
    if (state.samePageCount > pageCap) {
      await cooldown(parseInt(state.opts.pageCool || "60", 10) * 60 * 1000, "same-page");
      state.samePageCount = 1;
    }

    // read
    const text = extractPostText(article.node);
    if (!text || text.length < 10) {
      log("Skip: insufficient text content");
      return;
    }
    
    await readPostPause(article.node, text);

    // comment-off?
    if (!isCommentEnabled(article.node)) {
      log("Skip: comments off/disabled");
      return;
    }

    // limits before action
    let lim = underLimits(state.opts);
    if (!lim.ok) {
      if (lim.reason === "session cap") {
        await cooldown(parseInt(state.opts.coolSession || "30", 10) * 60 * 1000, "session");
        state.actionsDone = 0; // reset for next session window
      } else {
        // soft wait few seconds
        await sleep(randInt(4000, 7000));
      }
    }

    // reaction
    const reaction = decideReactionByContext(text, state.opts.reactMode);
    const reactionResult = await reactOnPost(article.node, reaction);
    log(`Reacted with: ${reactionResult.reaction} (${reactionResult.mode})`);

    // open composer inline & comment
    await openInlineCommentArea(article.node);
    let editor = findInlineComposer(article.node);
    if (!editor) {
      log("No composer found → skip");
      return;
    }

    const finalText = await buildContextCommentFor(text, state.opts);
    await typeLikeHuman(editor, finalText, state.opts.typing === "true");
    await submitComment(editor);

    // close composer
    await closeComposer();

    // record action & spacing
    state.actionsDone++;
    recordAction();
    state.processedIds.add(article.id);

  } catch (error) {
    log("Processing error:", error);
    state.fails++;
    
    if (state.fails >= parseInt(state.opts.failN || "5", 10)) {
      await cooldown(parseInt(state.opts.coolFail || "20", 10) * 60 * 1000, "fail");
      state.fails = 0;
    }
  }
}

// ===== Loop =====
function parseOpts(o) {
  const opts = { ...o };
  
  // Load custom settings if available
  chrome.storage.sync.get("fbAutoCustomSettings", (result) => {
    if (result.fbAutoCustomSettings) {
      const custom = result.fbAutoCustomSettings;
      
      // Merge custom settings with passed options
      if (custom.commentBuilder) Object.assign(opts, custom.commentBuilder);
      if (custom.reaction) Object.assign(opts, custom.reaction);
      if (custom.rateMix) Object.assign(opts, custom.rateMix);
      if (custom.linkManager) {
        opts.alwaysAttach = custom.linkManager.alwaysAttach;
        opts.attachProbability = custom.linkManager.attachProbability;
      }
    }
  });
  
  return opts;
}

async function mainLoop() {
  const dMin = Math.max(1, parseInt(state.opts.delayMin || "20", 10)) * 1000;
  const dMax = Math.max(dMin + 1000, parseInt(state.opts.delayMax || "30", 10) * 1000);
  
  while (state.running) {
    // scroll a bit
    await autoScrollStep(state.opts.scrollSpeed);

    // process 1–2 posts per cycle
    const posts = visibleArticles(2);
    for (const p of posts) {
      if (!state.running) break;
      
      try {
        await processOnePost(p);
        
        // spacing between processed posts
        const wait = randInt(dMin, dMax);
        await sleep(wait);
      } catch (e) {
        log("Error:", e?.message || e);
        state.fails++;
        
        if (state.fails >= parseInt(state.opts.failN || "5", 10)) {
          await cooldown(parseInt(state.opts.coolFail || "20", 10) * 60 * 1000, "fail");
          state.fails = 0;
        }
      }
    }
    
    await sleep(randInt(400, 900));
  }
}

// ===== Messaging =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "FB_AUTO_START_INLINE") {
    state.running = true; 
    state.actionsDone = 0; 
    state.fails = 0; 
    state.opts = parseOpts(msg.opts || {});
    state.processedIds.clear();
    
    log("Starting inline with opts:", state.opts);
    mainLoop(); 
    sendResponse?.({ ok: true }); 
    return true;
  }
  
  if (msg?.type === "FB_AUTO_STOP") {
    state.running = false; 
    log("Stopped."); 
    sendResponse?.({ ok: true }); 
    return true;
  }
  
  if (msg?.type === "FB_AUTO_STATUS") {
    sendResponse?.({ running: state.running });
    return true;
  }
});

// Initialize
chrome.runtime.sendMessage({ type: "FB_AUTO_STATUS" }, (response) => {
  if (response?.running) {
    state.running = true;
    mainLoop();
  }
});