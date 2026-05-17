(() => {
  const HOOK_FLAG = "__bossObserverNetworkDebugHookInstalled";
  const CONTROL_SOURCE = "bossObserver.networkDebug.control";
  const REQUEST_SOURCE = "bossObserver.networkDebug.request";
  const MAX_CAPTURE_CHARS = 200000;

  if (window[HOOK_FLAG]) {
    return;
  }
  window[HOOK_FLAG] = true;

  const state = {
    enabled: false,
    maxPreviewChars: 12000
  };

  let sequence = 0;
  const originalFetch = window.fetch;
  const originalOpen = window.XMLHttpRequest?.prototype?.open;
  const originalSend = window.XMLHttpRequest?.prototype?.send;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== CONTROL_SOURCE) {
      return;
    }
    state.enabled = event.data.enabled === true;
    state.maxPreviewChars = Number.isFinite(Number(event.data.maxPreviewChars)) ?
      Number(event.data.maxPreviewChars) :
      state.maxPreviewChars;
  });

  if (typeof originalFetch === "function") {
    window.fetch = async function bossObserverFetch(input, init) {
      const startedAt = Date.now();
      const request = readFetchRequest(input, init);
      try {
        const response = await originalFetch.apply(this, arguments);
        captureFetchResponse(request, response, startedAt);
        return response;
      } catch (error) {
        postRequest({
          ...request,
          id: createRequestId("fetch"),
          observedAt: new Date().toISOString(),
          sourcePageUrl: window.location.href,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    };
  }

  if (originalOpen && originalSend && window.XMLHttpRequest?.prototype) {
    window.XMLHttpRequest.prototype.open = function bossObserverXhrOpen(method, url) {
      this.__bossObserverRequest = {
        type: "xhr",
        method: method || "GET",
        url: safeAbsoluteUrl(url)
      };
      return originalOpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function bossObserverXhrSend(body) {
      const request = {
        ...(this.__bossObserverRequest || { type: "xhr", method: "GET", url: "" }),
        requestBodyPreview: stringifyBodyPreview(body),
        requestBodyLength: estimateBodyLength(body)
      };
      const startedAt = Date.now();
      this.addEventListener("loadend", () => {
        postRequest({
          ...request,
          id: createRequestId("xhr"),
          observedAt: new Date().toISOString(),
          sourcePageUrl: window.location.href,
          status: this.status,
          statusText: this.statusText,
          ok: this.status >= 200 && this.status < 300,
          durationMs: Date.now() - startedAt,
          responseContentType: this.getResponseHeader?.("content-type") || "",
          ...readXhrResponsePreview(this)
        });
      });
      return originalSend.apply(this, arguments);
    };
  }

  function captureFetchResponse(request, response, startedAt) {
    if (!state.enabled) {
      return;
    }

    const base = {
      ...request,
      id: createRequestId("fetch"),
      observedAt: new Date().toISOString(),
      sourcePageUrl: window.location.href,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      responseContentType: response.headers?.get("content-type") || ""
    };

    if (!shouldReadBody(base.responseContentType, response.headers?.get("content-length"))) {
      postRequest(base);
      return;
    }

    response.clone().text()
      .then((bodyText) => {
        postRequest({
          ...base,
          responseBodyPreview: bodyText.slice(0, state.maxPreviewChars),
          responseBodyLength: bodyText.length,
          responseBodyTruncated: bodyText.length > state.maxPreviewChars
        });
      })
      .catch((error) => {
        postRequest({
          ...base,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  function postRequest(request) {
    if (!state.enabled || !isBossRequestUrl(request.url)) {
      return;
    }

    const message = {
      source: REQUEST_SOURCE,
      request
    };
    window.postMessage(message, window.location.origin);
  }

  function readFetchRequest(input, init = {}) {
    const methodFromInput = typeof input === "object" && input?.method ? input.method : "";
    const body = init?.body;
    return {
      type: "fetch",
      method: init?.method || methodFromInput || "GET",
      url: safeAbsoluteUrl(typeof input === "string" ? input : input?.url || ""),
      requestBodyPreview: stringifyBodyPreview(body),
      requestBodyLength: estimateBodyLength(body)
    };
  }

  function readXhrResponsePreview(xhr) {
    if (xhr.responseType && xhr.responseType !== "text" && xhr.responseType !== "json") {
      return {};
    }

    try {
      const text = xhr.responseType === "json" ?
        JSON.stringify(xhr.response) :
        String(xhr.responseText || "");
      return {
        responseBodyPreview: text.slice(0, state.maxPreviewChars),
        responseBodyLength: text.length,
        responseBodyTruncated: text.length > state.maxPreviewChars
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  function shouldReadBody(contentType = "", contentLength = "") {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > MAX_CAPTURE_CHARS) {
      return false;
    }

    if (!contentType) {
      return true;
    }

    return /(?:json|text|javascript|html|xml|x-www-form-urlencoded)/i.test(contentType);
  }

  function safeAbsoluteUrl(value) {
    try {
      return new URL(String(value || ""), window.location.href).href;
    } catch {
      return String(value || "");
    }
  }

  function isBossRequestUrl(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.hostname === "zhipin.com" ||
        parsed.hostname === "www.zhipin.com" ||
        parsed.hostname.endsWith(".zhipin.com");
    } catch {
      return false;
    }
  }

  function stringifyBodyPreview(body) {
    if (body === undefined || body === null) {
      return "";
    }
    if (typeof body === "string") {
      return body.slice(0, state.maxPreviewChars);
    }
    if (body instanceof URLSearchParams) {
      return body.toString().slice(0, state.maxPreviewChars);
    }
    if (body instanceof FormData) {
      return Array.from(body.entries())
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : "[file]"}`)
        .join("&")
        .slice(0, state.maxPreviewChars);
    }
    if (body instanceof Blob) {
      return `[blob:${body.type || "unknown"}:${body.size}]`;
    }
    return `[${Object.prototype.toString.call(body)}]`;
  }

  function estimateBodyLength(body) {
    if (body === undefined || body === null) {
      return 0;
    }
    if (typeof body === "string") {
      return body.length;
    }
    if (body instanceof URLSearchParams) {
      return body.toString().length;
    }
    if (body instanceof FormData) {
      return stringifyBodyPreview(body).length;
    }
    if (body instanceof Blob) {
      return body.size;
    }
    return 0;
  }

  function createRequestId(prefix) {
    sequence += 1;
    return `${prefix}_${Date.now()}_${sequence}`;
  }
})();
