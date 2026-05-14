import { classifyPage } from "../shared/page-classifier.js";
import { getOrCreateSessionId } from "../shared/id.js";
import { nowLocalIsoString } from "../shared/time.js";

export class SessionContext {
  constructor() {
    this.sessionId = getOrCreateSessionId();
    this.page = classifyPage(location.href);
    this.title = document.title;
    this.startedAt = nowLocalIsoString();
    this.jobContext = null;
  }

  updatePage(url = location.href, title = document.title) {
    const previous = this.page;
    this.page = classifyPage(url);
    const previousTitle = this.title;
    this.title = title;
    return { previous, current: this.page, previousTitle, currentTitle: this.title };
  }

  updateTitle(title = document.title) {
    const previous = this.title;
    this.title = title;
    return { previous, current: this.title };
  }

  updateJobContext(jobContext) {
    const previous = this.jobContext;
    this.jobContext = jobContext || null;
    return { previous, current: this.jobContext };
  }

  snapshot() {
    return {
      sessionId: this.sessionId,
      pageType: this.page.pageType,
      pageUrl: this.page.url,
      pageTitle: this.title,
      isBossPage: this.page.isBossPage,
      jobContext: this.jobContext,
      startedAt: this.startedAt
    };
  }
}
