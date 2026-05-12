import test from "node:test";
import assert from "node:assert/strict";

import { PageSessionProbe } from "../extension/src/content/page-session-probe.js";
import { EVENT_TYPES } from "../extension/src/shared/event-types.js";
import { classifyPage } from "../extension/src/shared/page-classifier.js";

test("page session probe emits a single page_changed when title updates after url switch", () => {
  const initialUrl = "https://www.zhipin.com/web/chat/index?job=1";
  const nextUrl = "https://www.zhipin.com/web/chat/index?job=2";
  const restore = mockBrowserGlobals({
    href: initialUrl,
    title: "Chat - Loading"
  });

  try {
    const sessionContext = createSessionContext(initialUrl, "Chat - Loading");
    const collector = createCollector();
    const probe = new PageSessionProbe({
      collector,
      sessionContext,
      config: {
        debug: false,
        minDwellMs: Number.MAX_SAFE_INTEGER
      }
    });

    location.href = nextUrl;
    probe.onRouteMaybeChanged("pushState");

    document.title = "Chat - Ready";
    probe.onRouteMaybeChanged("poll");

    const pageChangedEvents = collector.events.filter(
      (event) => event.type === EVENT_TYPES.PAGE_CHANGED
    );

    assert.equal(pageChangedEvents.length, 1);
    assert.equal(sessionContext.title, "Chat - Ready");
    assert.equal(pageChangedEvents[0].payload.previous.url, initialUrl);
    assert.equal(pageChangedEvents[0].payload.current.url, nextUrl);
  } finally {
    restore();
  }
});

function createCollector() {
  return {
    events: [],
    collect(type, payload) {
      const event = { type, payload };
      this.events.push(event);
      return event;
    }
  };
}

function createSessionContext(url, title) {
  return {
    page: classifyPage(url),
    title,
    startedAt: "2026-05-11T00:00:00.000Z",
    updatePage(nextUrl, nextTitle) {
      const previous = this.page;
      this.page = classifyPage(nextUrl);
      const previousTitle = this.title;
      this.title = nextTitle;
      return {
        previous,
        current: this.page,
        previousTitle,
        currentTitle: this.title
      };
    },
    updateTitle(nextTitle) {
      const previous = this.title;
      this.title = nextTitle;
      return {
        previous,
        current: this.title
      };
    }
  };
}

function mockBrowserGlobals({ href, title }) {
  const original = {
    history: globalThis.history,
    document: globalThis.document,
    location: globalThis.location
  };

  globalThis.history = {
    pushState() {},
    replaceState() {}
  };
  globalThis.document = {
    title
  };
  globalThis.location = {
    href
  };

  return () => {
    restoreGlobal("history", original.history);
    restoreGlobal("document", original.document);
    restoreGlobal("location", original.location);
  };
}

function restoreGlobal(name, value) {
  if (value === undefined) {
    delete globalThis[name];
    return;
  }

  globalThis[name] = value;
}
