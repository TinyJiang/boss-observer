import { nowLocalIsoString } from "../shared/time.js";

const ACCOUNT_SELECTOR_CANDIDATES = [
  "[class*='user']",
  "[class*='account']",
  "[class*='avatar']",
  "[class*='name']",
  "[class*='header']",
  "[class*='nav']",
  "[aria-label]",
  "[title]"
];

const ACCOUNT_BLOCKED_TERMS = [
  "BOSS直聘",
  "推荐牛人",
  "搜索牛人",
  "职位",
  "沟通",
  "消息",
  "我的",
  "首页",
  "牛人",
  "招聘",
  "公司",
  "账号",
  "设置",
  "退出",
  "登录",
  "注册",
  "个人中心",
  "安全验证",
  "管理",
  "数据",
  "打招呼",
  "简历"
];

export class AccountIdentityProbe {
  constructor({ config = {}, intervalMs = 1500, now = nowLocalIsoString } = {}) {
    this.config = config;
    this.intervalMs = intervalMs;
    this.now = now;
    this.started = false;
    this.pollHandle = null;
    this.reportTimer = null;
    this.observer = null;
    this.lastSignature = "";
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.report();
    this.pollHandle = globalThis.setInterval(() => this.report(), this.intervalMs);
    if (typeof MutationObserver !== "undefined" && document.documentElement) {
      this.observer = new MutationObserver(() => this.scheduleReport());
      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "style", "title", "aria-label"]
      });
    }
  }

  stop() {
    if (!this.started) {
      return;
    }

    this.started = false;
    if (this.pollHandle !== null) {
      globalThis.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.reportTimer !== null) {
      globalThis.clearTimeout(this.reportTimer);
      this.reportTimer = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  scheduleReport() {
    if (this.reportTimer !== null) {
      return;
    }

    this.reportTimer = globalThis.setTimeout(() => {
      this.reportTimer = null;
      this.report();
    }, 250);
  }

  report() {
    const observation = findBossAccountObservation(document, {
      expectedName: this.config.accountName,
      observedAt: this.now(),
      pageUrl: location.href
    });
    const signature = [
      observation.accountName || "",
      observation.source || "",
      observation.confidence || "",
      observation.pageUrl || ""
    ].join("|");
    if (signature === this.lastSignature) {
      return;
    }

    this.lastSignature = signature;
    chrome.runtime.sendMessage({
      kind: "bossObserver.bossAccountObserved",
      account: observation
    }, () => {
      void chrome.runtime.lastError;
    });
  }
}

export function findBossAccountObservation(root = document, {
  expectedName = "",
  observedAt = nowLocalIsoString(),
  pageUrl = "",
  viewportWidth = globalThis.innerWidth || 1440
} = {}) {
  const candidates = collectBossAccountCandidates(root, { viewportWidth });
  const picked = pickBossAccountCandidate(candidates, { expectedName, viewportWidth });
  if (!picked) {
    return {
      accountName: "",
      source: "not_found",
      confidence: "none",
      observedAt,
      pageUrl
    };
  }

  return {
    accountName: picked.accountName,
    source: picked.source,
    confidence: picked.confidence,
    observedAt,
    pageUrl
  };
}

export function collectBossAccountCandidates(root = document, {
  viewportWidth = globalThis.innerWidth || 1440
} = {}) {
  const candidates = [];
  const seenElements = new Set();
  const elements = [];

  ACCOUNT_SELECTOR_CANDIDATES.forEach((selector) => {
    try {
      elements.push(...Array.from(root.querySelectorAll?.(selector) || []));
    } catch {
      // Ignore selector issues from non-browser test doubles.
    }
  });

  elements.slice(0, 800).forEach((element) => {
    if (!element || seenElements.has(element) || !isElementVisibleInHeader(element, viewportWidth)) {
      return;
    }
    seenElements.add(element);

    const rect = readRect(element);
    const source = describeElementSource(element);
    const names = extractLikelyAccountNames(readElementText(element));
    names.forEach((accountName) => {
      candidates.push({
        accountName,
        source,
        rect
      });
    });
  });

  return candidates;
}

export function pickBossAccountCandidate(candidates = [], {
  expectedName = "",
  viewportWidth = 1440
} = {}) {
  const expectedComparable = normalizeNameForCompare(expectedName);
  const scored = candidates
    .map((candidate) => {
      const accountName = cleanAccountName(candidate.accountName);
      if (!accountName || !isLikelyAccountName(accountName)) {
        return null;
      }

      const rect = candidate.rect || {};
      const comparable = normalizeNameForCompare(accountName);
      let score = 0;
      if (rect.top !== undefined && rect.top <= 140) {
        score += 3;
      }
      if (rect.right !== undefined && rect.right >= viewportWidth * 0.55) {
        score += 3;
      }
      if (String(candidate.source || "").includes("account") || String(candidate.source || "").includes("user")) {
        score += 2;
      }
      if (accountName.length >= 2 && accountName.length <= 6) {
        score += 1;
      }
      if (expectedComparable && comparable === expectedComparable) {
        score += 5;
      }

      return {
        ...candidate,
        accountName,
        score,
        confidence: score >= 8 ? "high" : "medium"
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  return scored[0] || null;
}

export function extractLikelyAccountNames(text = "") {
  const tokens = String(text || "")
    .replace(/[\r\n\t]+/g, "\n")
    .split(/[\n|｜,，;；/]+|\s{2,}/)
    .map(cleanAccountName)
    .filter(Boolean);

  return Array.from(new Set(tokens.filter(isLikelyAccountName)));
}

function isElementVisibleInHeader(element, viewportWidth) {
  const rect = readRect(element);
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  if (rect.top > 180 || rect.bottom < 0) {
    return false;
  }
  return rect.right >= viewportWidth * 0.45;
}

function readRect(element) {
  if (!element?.getBoundingClientRect) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  return {
    top: Number(rect.top) || 0,
    bottom: Number(rect.bottom) || 0,
    left: Number(rect.left) || 0,
    right: Number(rect.right) || 0,
    width: Number(rect.width) || 0,
    height: Number(rect.height) || 0
  };
}

function readElementText(element) {
  return [
    element.innerText,
    element.textContent,
    element.getAttribute?.("aria-label"),
    element.getAttribute?.("title")
  ].filter(Boolean).join("\n");
}

function describeElementSource(element) {
  const className = String(element.className || "");
  if (className.includes("account")) {
    return "top_header_account_class";
  }
  if (className.includes("user")) {
    return "top_header_user_class";
  }
  if (className.includes("avatar")) {
    return "top_header_avatar_class";
  }
  if (className.includes("name")) {
    return "top_header_name_class";
  }
  return "top_header_text";
}

function isLikelyAccountName(value = "") {
  const text = cleanAccountName(value);
  if (text.length < 2 || text.length > 16) {
    return false;
  }
  if (ACCOUNT_BLOCKED_TERMS.some((term) => text.includes(term))) {
    return false;
  }
  if (/^\d+$/.test(text)) {
    return false;
  }
  return /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·.\-_\s]{1,15}$/.test(text);
}

function cleanAccountName(value = "") {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNameForCompare(value = "") {
  return cleanAccountName(value)
    .replace(/\s+/g, "")
    .toLocaleLowerCase();
}
