export function sanitizeChatListJobTitle(value = "") {
  const text = stripChatJobTitlePrefix(value);
  const titleEndIndex = findChatJobTitleEndIndex(text);
  return text.slice(0, titleEndIndex).trim();
}

export function splitChatJobTitleAndPreview(value = "") {
  const text = stripChatJobTitlePrefix(value);
  const titleEndIndex = findChatJobTitleEndIndex(text);
  return {
    jobTitle: text.slice(0, titleEndIndex).trim(),
    lastMessagePreview: text.slice(titleEndIndex).trim()
  };
}

export function normalizeChatIdentityJobTitle(value = "") {
  return sanitizeChatListJobTitle(value).replace(/\s+/g, "");
}

function stripChatJobTitlePrefix(value = "") {
  return normalizeText(value)
    .replace(/^.*?沟通职位：/, "")
    .replace(/^\d{1,2}月\d{1,2}日\s*沟通的职位-/, "")
    .replace(/^[^【]{1,20}·(?=【)/, "")
    .trim();
}

function findChatJobTitleEndIndex(text = "") {
  if (!text) {
    return 0;
  }

  const bracketEndIndex = text.indexOf("】");
  if (bracketEndIndex < 0) {
    return text.length;
  }

  const parenEndIndex = findFirstParenEndIndexAfter(text, bracketEndIndex);
  if (parenEndIndex >= 0) {
    return parenEndIndex + 1;
  }

  const titleStartIndex = findFirstNonSpaceIndexAfter(text, bracketEndIndex + 1);
  if (titleStartIndex < 0) {
    return bracketEndIndex + 1;
  }

  const titleRest = text.slice(titleStartIndex);
  const titleSpaceIndex = titleRest.search(/\s+/);
  if (titleSpaceIndex < 0) {
    return text.length;
  }

  return titleStartIndex + titleSpaceIndex;
}

function findFirstParenEndIndexAfter(text, startIndex) {
  const chineseParenIndex = text.indexOf("）", startIndex);
  const asciiParenIndex = text.indexOf(")", startIndex);
  if (chineseParenIndex < 0) {
    return asciiParenIndex;
  }
  if (asciiParenIndex < 0) {
    return chineseParenIndex;
  }
  return Math.min(chineseParenIndex, asciiParenIndex);
}

function findFirstNonSpaceIndexAfter(text, startIndex) {
  const match = text.slice(startIndex).match(/\S/);
  return match ? startIndex + match.index : -1;
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}
