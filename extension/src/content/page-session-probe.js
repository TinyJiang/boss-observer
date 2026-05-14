import { EVENT_TYPES } from "../shared/event-types.js";

export class PageSessionProbe {
  constructor({ collector, sessionContext, config }) {
    this.collector = collector;
    this.sessionContext = sessionContext;
    this.config = config;
    this.started = false;
    this.currentPageStartedAt = Date.now();
    this.currentPage = sessionContext.page;
    this.originalPushState = history.pushState;
    this.originalReplaceState = history.replaceState;
    this.boundPageHide = () => this.safeRun("pagehide", () => this.onPageLeaving("pagehide"));
    this.boundBeforeUnload = () => this.safeRun("beforeunload", () => this.onPageLeaving("beforeunload"));
    this.boundPopState = () => this.safeRun("popstate", () => this.onRouteMaybeChanged("popstate"));
    this.boundHashChange = () => this.safeRun("hashchange", () => this.onRouteMaybeChanged("hashchange"));
    this.pollHandle = null;
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.collector.collect(EVENT_TYPES.PLUGIN_STARTED, {
      source: "content_script"
    });

    if (this.sessionContext.page.isBossPage) {
      this.collector.collect(EVENT_TYPES.BOSS_PAGE_ENTERED, buildBossPageEnteredPayload({
        source: "start"
      }));
    }

    this.patchHistory();
    globalThis.addEventListener("pagehide", this.boundPageHide);
    globalThis.addEventListener("beforeunload", this.boundBeforeUnload);
    globalThis.addEventListener("popstate", this.boundPopState);
    globalThis.addEventListener("hashchange", this.boundHashChange);
    this.startPolling();
  }

  stop(reason = "stopped") {
    if (!this.started) {
      return;
    }

    this.recordDwell(reason);
    this.started = false;
    history.pushState = this.originalPushState;
    history.replaceState = this.originalReplaceState;
    globalThis.removeEventListener("pagehide", this.boundPageHide);
    globalThis.removeEventListener("beforeunload", this.boundBeforeUnload);
    globalThis.removeEventListener("popstate", this.boundPopState);
    globalThis.removeEventListener("hashchange", this.boundHashChange);
    this.stopPolling();
  }

  patchHistory() {
    const notify = (source) => {
      queueMicrotask(() => this.safeRun(source, () => this.onRouteMaybeChanged(source)));
    };

    history.pushState = (...args) => {
      const result = this.originalPushState.apply(history, args);
      notify("pushState");
      return result;
    };

    history.replaceState = (...args) => {
      const result = this.originalReplaceState.apply(history, args);
      notify("replaceState");
      return result;
    };
  }

  onRouteMaybeChanged(source) {
    const previousUrl = this.currentPage.url;
    const currentTitle = document.title;
    const currentUrl = location.href;
    if (previousUrl === currentUrl) {
      if (this.sessionContext.title !== currentTitle) {
        this.sessionContext.updateTitle(currentTitle);
      }
      return;
    }

    this.recordDwell(`route:${source}`);
    const { previous, current } = this.sessionContext.updatePage(currentUrl, currentTitle);
    this.currentPage = current;
    this.currentPageStartedAt = Date.now();

    this.collector.collect(EVENT_TYPES.PAGE_CHANGED, buildPageChangedPayload({
      source,
      previous,
      current
    }));

    if (!previous.isBossPage && current.isBossPage) {
      this.collector.collect(EVENT_TYPES.BOSS_PAGE_ENTERED, buildBossPageEnteredPayload({ source }));
    }

    if (previous.isBossPage && !current.isBossPage) {
      this.collector.collect(EVENT_TYPES.BOSS_PAGE_LEFT, buildBossPageLeftPayload({
        page: previous,
        source
      }));
    }
  }

  onPageLeaving(source) {
    this.recordDwell(source);
    if (this.sessionContext.page.isBossPage) {
      this.collector.collect(EVENT_TYPES.BOSS_PAGE_LEFT, buildBossPageLeftPayload({
        page: this.sessionContext.page,
        source
      }));
    }
  }

  recordDwell(reason) {
    const dwellMs = Date.now() - this.currentPageStartedAt;
    if (dwellMs < this.config.minDwellMs) {
      return;
    }

    this.collector.collect(EVENT_TYPES.PAGE_DWELL_RECORDED, {
      dwellMs,
      reason
    });
  }

  safeRun(source, action) {
    try {
      action();
    } catch (error) {
      this.collector.collect(EVENT_TYPES.PLUGIN_EXCEPTION, {
        source,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  startPolling() {
    this.stopPolling();
    this.pollHandle = globalThis.setInterval(() => {
      this.safeRun("poll", () => this.onRouteMaybeChanged("poll"));
    }, 2000);
  }

  stopPolling() {
    if (this.pollHandle !== null) {
      globalThis.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }
}

function buildPageChangedPayload({ source = "", previous = {}, current = {} } = {}) {
  return compactPageSessionPayload({
    source,
    previousPageType: previous.pageType,
    previousUrl: previous.url,
    currentPageType: current.pageType,
    currentUrl: current.url
  });
}

function buildBossPageEnteredPayload({ source = "" } = {}) {
  return compactPageSessionPayload({ source });
}

function buildBossPageLeftPayload({ page = {}, source = "" } = {}) {
  return compactPageSessionPayload({
    source,
    leftPageType: page.pageType,
    leftPageUrl: page.url
  });
}

function compactPageSessionPayload(value = {}) {
  const result = {};
  Object.entries(value || {}).forEach(([key, current]) => {
    if (current !== null && current !== undefined && current !== "") {
      result[key] = current;
    }
  });
  return result;
}
