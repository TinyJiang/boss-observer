const BOSS_HOSTS = new Set(["www.zhipin.com", "zhipin.com"]);

const PAGE_RULES = [
  {
    type: "site_home",
    matches: ({ pathname }) => pathname === "/" || /^\/[^/]+\/?$/.test(pathname)
  },
  {
    type: "user_account",
    matches: ({ pathname }) => pathname.startsWith("/web/user")
  },
  {
    type: "candidate_detail",
    matches: ({ pathname, search }) =>
      pathname.includes("/geek/detail") ||
      pathname.includes("/resume/detail") ||
      search.includes("geekId=")
  },
  {
    type: "candidate_recommend",
    matches: ({ pathname, search }) =>
      pathname === "/web/chat/recommend" ||
      pathname.includes("/geek/recommend") ||
      search.includes("recommend")
  },
  {
    type: "candidate_search",
    matches: ({ pathname, search }) =>
      pathname === "/web/chat/search" ||
      pathname.includes("/geek/search") ||
      search.includes("search")
  },
  {
    type: "candidate_intention",
    matches: ({ pathname }) => pathname === "/web/chat/intention"
  },
  {
    type: "candidate_interaction",
    matches: ({ pathname }) => pathname === "/web/chat/interaction"
  },
  {
    type: "candidate_manage",
    matches: ({ pathname }) =>
      pathname.startsWith("/web/chat/geek/manage") ||
      pathname.includes("/geek/manage")
  },
  {
    type: "recruiting_data",
    matches: ({ pathname }) => pathname === "/web/chat/data-recruit"
  },
  {
    type: "business_mall",
    matches: ({ pathname }) => pathname.startsWith("/web/chat/business/mall")
  },
  {
    type: "project_outsource",
    matches: ({ pathname }) => pathname.startsWith("/web/chat/hezuo")
  },
  {
    type: "job_manage",
    matches: ({ pathname }) =>
      pathname.includes("/job") ||
      pathname.includes("/position") ||
      pathname === "/web/chat/job/list"
  },
  {
    type: "chat",
    matches: ({ pathname }) => pathname.startsWith("/web/chat")
  }
];

export function isBossUrl(url) {
  try {
    const parsed = new URL(url);
    return BOSS_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function classifyPage(url) {
  try {
    const parsed = new URL(url);
    if (!BOSS_HOSTS.has(parsed.hostname)) {
      return {
        pageType: "non_boss",
        isBossPage: false,
        url
      };
    }

    const rule = PAGE_RULES.find((candidate) => candidate.matches(parsed));
    return {
      pageType: rule ? rule.type : "boss_unknown",
      isBossPage: true,
      url: parsed.href,
      host: parsed.hostname,
      path: parsed.pathname,
      query: parsed.search
    };
  } catch (error) {
    return {
      pageType: "invalid_url",
      isBossPage: false,
      url,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}
