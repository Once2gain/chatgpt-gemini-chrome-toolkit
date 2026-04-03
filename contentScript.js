/*
 * Conversation Toolkit
 * - Optimize long conversations by collapsing older message DOM nodes.
 * - Export the current conversation in JSON with one click.
 * - Bulk delete rendered sidebar conversations.
 * - Supports ChatGPT and Gemini.
 */
(() => {
  const TOOLKIT_ID = "chatgpt-conversation-toolkit";
  const STATUS_ID = "chatgpt-conversation-toolkit-status";
  const MINIMIZED_ID = "chatgpt-toolkit-minimized";
  const TOOLKIT_ANCHOR_ID = "chatgpt-conversation-toolkit-anchor";
  const HOVER_NAVIGATION_ID = "chatgpt-toolkit-hover-navigation";
  const POSITION_KEY = "chatgpt-toolkit-position";
  const COLLAPSE_TOGGLE_BUTTON_ID = "chatgpt-toolkit-collapse-toggle";
  const BULK_DELETE_BUTTON_ID = "chatgpt-toolkit-bulk-toggle";
  const BULK_DELETE_POPOVER_ID = "chatgpt-toolkit-bulk-popover";
  const BULK_DELETE_SUMMARY_ID = "chatgpt-toolkit-bulk-summary-count";
  const CONFIRM_DIALOG_ID = "chatgpt-toolkit-confirm-delete-dialog";
  const NAVIGATION_TARGET_OFFSET = 112;
  const NAVIGATION_TARGET_LINE = 112;
  const NAVIGATION_TOLERANCE = 20;
  const DEFAULT_VISIBLE_ROUNDS = 5;
  const TOOLKIT_POPUP_GAP = 12;
  const TOOLKIT_VIEWPORT_MARGIN = 16;
  const OBSERVED_DOM_REFRESH_DELAY = 120;
  const SIDEBAR_ROW_CLASS = "chatgpt-toolkit-sidebar-row";
  const SIDEBAR_LINK_CLASS = "chatgpt-toolkit-sidebar-link";
  const SIDEBAR_CHECKBOX_HOST_CLASS = "chatgpt-toolkit-sidebar-checkbox-host";
  const SIDEBAR_CHECKBOX_CLASS = "chatgpt-toolkit-sidebar-checkbox";
  const UNFOLD_ROUNDS_INPUT_ID = "chatgpt-toolkit-unfold-rounds";
  const GEMINI_SIDEBAR_LINK_SELECTOR = 'a[data-test-id="conversation"][href]';
  const GEMINI_SIDEBAR_ROW_SELECTOR = ".conversation-items-container";
  const GEMINI_MESSAGE_CONTAINER_SELECTOR = ".conversation-container";
  const OBSERVED_REFRESH_RELEVANT_SELECTOR = [
    "main",
    "nav",
    "aside",
    "article",
    "[data-message-author-role]",
    "[data-conversation-id]",
    '[data-testid^="conversation-turn-"]',
    '[data-test-id="chat-history-container"]',
    '[id^="history"]',
    '[id^="conversations-list-"]',
    GEMINI_SIDEBAR_LINK_SELECTOR,
    GEMINI_SIDEBAR_ROW_SELECTOR,
    GEMINI_MESSAGE_CONTAINER_SELECTOR,
    "chat-window-content",
  ].join(", ");

  const IS_GEMINI = /(^|\.)gemini\.google\.com$/i.test(window.location.hostname);
  const PRODUCT_NAME = IS_GEMINI ? "Gemini" : "ChatGPT";
  const TOOLKIT_TITLE = `${PRODUCT_NAME} 工具`;
  const EXPORT_FILENAME_PREFIX = IS_GEMINI ? "gemini-session" : "chatgpt-session";
  const CHATGPT_ICON_URL =
    typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL("image/icon.jpg")
      : "";
  const GEMINI_ICON_URL =
    typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL("gemini-icon.png")
      : "";

  const DELETE_MENU_TEXTS = [
    "Delete",
    "Delete chat",
    "Delete conversation",
    "Delete activity",
    "删除",
    "删除会话",
    "删除对话",
    "删除聊天",
    "刪除",
    "刪除對話",
    "削除",
    "삭제",
    "Eliminar",
    "Excluir",
    "Supprimer",
    "Löschen",
    "Elimina",
    "Удалить",
  ];
  const DELETE_CONFIRM_TEXTS = [
    ...DELETE_MENU_TEXTS,
    "确认删除",
    "確認刪除",
    "继续删除",
    "Delete forever",
  ];
  const CANCEL_TEXTS = ["Cancel", "取消", "取消删除", "關閉"];
  const OPTIONS_TEXTS = ["More", "更多", "Options", "选项", "Menu", "菜单"];
  const DECORATION_REMOVAL_SELECTORS = [
    "button",
    "mat-icon",
    "svg",
    "script",
    "style",
    "noscript",
    ".action-button",
    ".conversation-title-cover",
    ".response-container-header",
    ".response-actions-container",
    ".message-actions-container",
    ".feedback-container",
    ".cdk-visually-hidden",
    ".sr-only",
    '[aria-hidden="true"]',
    "[role='button']",
  ];

  if (document.getElementById(TOOLKIT_ID)) {
    return;
  }

  const state = {
    isCollapsed: false,
    isMinimized: true,
    visibleRoundCount: DEFAULT_VISIBLE_ROUNDS,
    collapsedNodes: [],
    cachedNodes: [],
    conversationKey: null,
    bulkDeleteMode: false,
    selectedConversationKeys: new Set(),
    bulkDeleteSyncQueued: false,
    isDeletingConversations: false,
    jumpHighlightTimer: null,
    highlightedMessageNode: null,
    hoverNavigationVisible: false,
    hoverNavigationHideTimer: null,
    toolbarPlacement: "placement-rd",
    observerRefreshQueued: false,
  };

  const delay = (ms) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });

  const waitForValue = async (resolver, timeout = 2000, interval = 100) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const value = resolver();
      if (value) {
        return value;
      }
      await delay(interval);
    }
    return null;
  };

  const normalizeText = (value = "") => value.replace(/\s+/g, " ").trim().toLowerCase();
  const collapseWhitespace = (value = "") => value.replace(/\s+/g, " ").trim();

  const textIncludes = (value, candidates) => {
    const normalized = normalizeText(value);
    return candidates.some((candidate) => normalized.includes(normalizeText(candidate)));
  };

  const isVisible = (element) => Boolean(element && element.getClientRects().length);

  const isHTMLElement = (value) => value instanceof HTMLElement;

  const getAccessibleText = (element) =>
    collapseWhitespace(
      [
        element?.textContent || "",
        element?.getAttribute?.("aria-label") || "",
        element?.getAttribute?.("title") || "",
        element?.getAttribute?.("data-testid") || "",
        element?.getAttribute?.("data-test-id") || "",
      ]
        .filter(Boolean)
        .join(" ")
    );

  const isToolkitManagedElement = (element) =>
    Boolean(
      element &&
        (element.id === TOOLKIT_ID ||
          element.id === TOOLKIT_ANCHOR_ID ||
          element.id === CONFIRM_DIALOG_ID ||
          element.closest?.(`#${TOOLKIT_ANCHOR_ID}`) ||
          element.closest?.(`#${CONFIRM_DIALOG_ID}`))
    );

  const mutationNodeCouldAffectToolkit = (node) => {
    if (!(node instanceof Element) || isToolkitManagedElement(node)) {
      return false;
    }

    return (
      node.matches(OBSERVED_REFRESH_RELEVANT_SELECTOR) ||
      Boolean(node.querySelector(OBSERVED_REFRESH_RELEVANT_SELECTOR))
    );
  };

  const shouldScheduleObservedDomRefresh = (mutations) => {
    if (!getToolkitAnchor() || !document.getElementById(TOOLKIT_ID)) {
      return true;
    }

    return mutations.some((mutation) => {
      if (mutation.type !== "childList") {
        return false;
      }

      if (mutation.target instanceof Element && isToolkitManagedElement(mutation.target)) {
        return false;
      }

      return [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
        mutationNodeCouldAffectToolkit(node)
      );
    });
  };

  const extractSanitizedText = (node, selectors = []) => {
    if (!node) {
      return "";
    }

    const clone = node.cloneNode(true);
    [...DECORATION_REMOVAL_SELECTORS, ...selectors].forEach((selector) => {
      clone.querySelectorAll(selector).forEach((element) => element.remove());
    });

    return collapseWhitespace(clone.textContent || "");
  };

  const dedupeElements = (nodes, getKey) => {
    const seen = new Set();
    const unique = [];

    nodes.forEach((node) => {
      if (!node) {
        return;
      }
      const key = getKey(node);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      unique.push(node);
    });

    return unique;
  };

  const dispatchMouseLikeEvent = (element, type) => {
    if (!element) {
      return;
    }
    const baseInit = { bubbles: true, cancelable: true, view: window };
    if (type.startsWith("pointer") && typeof PointerEvent === "function") {
      element.dispatchEvent(new PointerEvent(type, { ...baseInit, pointerType: "mouse" }));
      return;
    }
    element.dispatchEvent(new MouseEvent(type, baseInit));
  };

  const hoverElement = (element) => {
    ["pointerenter", "mouseenter", "mouseover", "mousemove"].forEach((type) => {
      dispatchMouseLikeEvent(element, type);
    });
  };

  const triggerElementClick = (element) => {
    if (!element) {
      return;
    }
    ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach((type) => {
      dispatchMouseLikeEvent(element, type);
    });
    element.click();
  };

  const truncateText = (value, maxLength = 28) => {
    if (!value || value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength - 1)}…`;
  };

  const normalizeChatGptMessageNode = (node) =>
    node.closest('[data-testid^="conversation-turn-"]') || node.closest("article") || node;

  const getChatGptRoleNode = (node) =>
    node?.matches?.("[data-message-author-role]")
      ? node
      : node?.querySelector?.("[data-message-author-role]") || node;

  const getChatGptNodeConversationId = (node) =>
    node?.getAttribute("data-conversation-id") ||
    node?.dataset?.conversationId ||
    node?.querySelector?.("[data-conversation-id]")?.getAttribute("data-conversation-id") ||
    null;

  const getConversationKey = () => {
    if (IS_GEMINI) {
      const match = window.location.pathname.match(/\/app\/([^/?#]+)/);
      if (match) {
        return match[1];
      }
      return `${window.location.pathname}${window.location.search}`;
    }

    const domConversationId =
      document.querySelector("[data-conversation-id]")?.getAttribute("data-conversation-id") ||
      document
        .querySelector("[data-message-id][data-conversation-id]")
        ?.getAttribute("data-conversation-id");
    if (domConversationId) {
      return domConversationId;
    }

    const match = window.location.pathname.match(/\/c\/([^/]+)/);
    if (match) {
      return match[1];
    }
    return `${window.location.pathname}${window.location.search}`;
  };

  const resetConversationState = () => {
    state.isCollapsed = false;
    state.visibleRoundCount = DEFAULT_VISIBLE_ROUNDS;
    state.collapsedNodes = [];
    state.cachedNodes = [];
    clearJumpHighlight();
    renderCollapseToggleControl();
  };

  const ensureConversationState = () => {
    const nextKey = getConversationKey();
    if (state.conversationKey !== nextKey) {
      state.conversationKey = nextKey;
      resetConversationState();
      return true;
    }
    return false;
  };

  const getGeminiHistoryRoot = () =>
    document.querySelector('[data-test-id="chat-history-container"]') ||
    document.getElementById("chat-history") ||
    document.querySelector("chat-window-content") ||
    document.querySelector("main");

  const getMessageNodes = () => {
    if (IS_GEMINI) {
      const root = getGeminiHistoryRoot();
      if (!root) {
        return [];
      }

      const containers = Array.from(root.querySelectorAll(GEMINI_MESSAGE_CONTAINER_SELECTOR)).filter(
        (node) => isVisible(node) && node.querySelector("user-query, model-response")
      );

      return dedupeElements(containers, (node) => node.id || node);
    }

    const main = document.querySelector("main");
    if (!main) {
      return [];
    }

    const candidates = [
      ...Array.from(main.querySelectorAll("[data-message-author-role]")),
      ...Array.from(main.querySelectorAll("article")),
    ];

    const normalized = candidates
      .map((node) => normalizeChatGptMessageNode(node))
      .filter(Boolean);

    const filteredByConversation = (() => {
      if (!state.conversationKey) {
        return normalized;
      }
      const scoped = normalized.filter((node) => {
        const nodeConversationId = getChatGptNodeConversationId(node);
        return !nodeConversationId || nodeConversationId === state.conversationKey;
      });
      return scoped.length > 0 ? scoped : normalized;
    })();

    return dedupeElements(filteredByConversation, (node) => {
      const messageId = node.getAttribute("data-message-id");
      const testId = node.getAttribute("data-testid");
      return messageId || testId || node;
    });
  };

  const detectRole = (node) => {
    if (IS_GEMINI) {
      if (node?.matches?.("user-query") || node?.querySelector?.("user-query")) {
        return "user";
      }
      if (node?.matches?.("model-response") || node?.querySelector?.("model-response")) {
        return "assistant";
      }
      return "assistant";
    }

    const explicitRole =
      node?.getAttribute?.("data-message-author-role") || node?.dataset?.messageAuthorRole;
    if (explicitRole) {
      return explicitRole;
    }

    if (node?.querySelector?.('[data-message-author-role="assistant"]')) {
      return "assistant";
    }
    if (node?.querySelector?.('[data-message-author-role="user"]')) {
      return "user";
    }
    if (
      node?.querySelector?.(
        'img[alt*="ChatGPT"], svg[aria-label*="ChatGPT"], svg[aria-label*="Assistant"]'
      )
    ) {
      return "assistant";
    }
    if (node?.querySelector?.('img[alt*="User"], svg[aria-label*="User"]')) {
      return "user";
    }
    return "assistant";
  };

  const extractMessageText = (node) => {
    if (!node) {
      return "";
    }

    if (IS_GEMINI) {
      if (node.matches?.("user-query") || node.querySelector?.("user-query")) {
        return extractSanitizedText(
          node.matches("user-query") ? node : node.querySelector("user-query"),
          [".file-preview-container"]
        );
      }

      const messageContent =
        node.querySelector?.("message-content .markdown") ||
        node.querySelector?.(".model-response-text .markdown") ||
        node.querySelector?.(".model-response-text") ||
        node;
      return extractSanitizedText(messageContent);
    }

    const contentNode =
      (node && node.querySelector && node.querySelector("[data-message-author-role]")) || node;
    return collapseWhitespace(contentNode?.textContent || "");
  };

  const buildMessagePayload = (nodes) => {
    if (IS_GEMINI) {
      return nodes
        .flatMap((node) => {
          const messages = [];

          const userQuery = node.querySelector("user-query");
          const userText = extractMessageText(userQuery);
          if (userText) {
            messages.push({ role: "user", text: userText });
          }

          const responseNodes = Array.from(node.querySelectorAll("model-response"));
          responseNodes.forEach((responseNode) => {
            const responseText = extractMessageText(responseNode);
            if (responseText) {
              messages.push({ role: "assistant", text: responseText });
            }
          });

          return messages;
        })
        .map((message, index) => ({
          index: index + 1,
          role: message.role,
          text: message.text,
        }));
    }

    const seenIds = new Set();
    return nodes
      .map((node) => {
        const roleNode = getChatGptRoleNode(node);
        const messageId =
          roleNode?.getAttribute("data-message-id") || node.getAttribute("data-message-id");
        if (messageId && seenIds.has(messageId)) {
          return null;
        }
        if (messageId) {
          seenIds.add(messageId);
        }

        const role = detectRole(roleNode);
        const text = extractMessageText(roleNode);
        if (!text) {
          return null;
        }

        return { role, text };
      })
      .filter(Boolean)
      .map((message, index) => ({
        index: index + 1,
        role: message.role,
        text: message.text,
      }));
  };

  const updateStatus = (message, tone = "info") => {
    const status = document.getElementById(STATUS_ID);
    if (!status) {
      return;
    }
    status.textContent = message;
    status.dataset.tone = tone;
  };

  const saveMinimizedPosition = (position) => {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  };

  const loadMinimizedPosition = () => {
    const stored = localStorage.getItem(POSITION_KEY);
    if (!stored) {
      return null;
    }
    try {
      return JSON.parse(stored);
    } catch (error) {
      return null;
    }
  };

  const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

  const getViewportAxisBounds = (viewportSize, elementSize) => {
    const maxStart = Math.max(0, viewportSize - elementSize);
    const min = Math.min(TOOLKIT_VIEWPORT_MARGIN, maxStart);
    const max = Math.max(min, maxStart - TOOLKIT_VIEWPORT_MARGIN);
    return { min, max };
  };

  const getAnchorDimensions = (anchor) => {
    const rect = anchor.getBoundingClientRect();
    return {
      width: Math.max(rect.width, anchor.offsetWidth || 0, 48),
      height: Math.max(rect.height, anchor.offsetHeight || 0, 48),
    };
  };

  const getClampedAnchorPosition = (anchor, position) => {
    const { width, height } = getAnchorDimensions(anchor);
    const xBounds = getViewportAxisBounds(window.innerWidth, width);
    const yBounds = getViewportAxisBounds(window.innerHeight, height);

    return {
      left: clampNumber(position.left, xBounds.min, xBounds.max),
      top: clampNumber(position.top, yBounds.min, yBounds.max),
    };
  };

  const applyAbsoluteAnchorPosition = (anchor, position) => {
    anchor.style.left = `${position.left}px`;
    anchor.style.top = `${position.top}px`;
    anchor.style.right = "auto";
    anchor.style.bottom = "auto";
  };

  const ensureAnchorWithinViewport = (anchor, persist = true) => {
    if (!anchor) {
      return null;
    }

    const rect = anchor.getBoundingClientRect();
    const nextPosition = getClampedAnchorPosition(anchor, {
      left: rect.left,
      top: rect.top,
    });
    const changed =
      Math.abs(nextPosition.left - rect.left) > 0.5 || Math.abs(nextPosition.top - rect.top) > 0.5;

    if (changed) {
      applyAbsoluteAnchorPosition(anchor, nextPosition);
    }

    if (persist && (changed || loadMinimizedPosition())) {
      saveMinimizedPosition(nextPosition);
    }

    return nextPosition;
  };

  const getAllConversationNodes = () => {
    const visibleNodes = getMessageNodes();
    const collapsedNodeSet = new Set(state.collapsedNodes.map(({ node }) => node));
    state.cachedNodes = dedupeElements(
      [
        ...state.cachedNodes.filter(
          (node) => Boolean(node) && (document.contains(node) || collapsedNodeSet.has(node))
        ),
        ...visibleNodes,
      ],
      (node) => node
    );
    return state.cachedNodes;
  };

  const buildConversationRounds = (nodes) => {
    const rounds = [];
    let pendingPreludeNodes = [];

    nodes.forEach((node) => {
      if (!node) {
        return;
      }

      const roleSource = IS_GEMINI ? node : getChatGptRoleNode(node);
      const role = detectRole(roleSource);

      if (role === "user") {
        const roundNodes = pendingPreludeNodes.length ? [...pendingPreludeNodes, node] : [node];
        rounds.push({
          index: rounds.length + 1,
          nodes: roundNodes,
          userNode: node,
        });
        pendingPreludeNodes = [];
        return;
      }

      if (rounds.length === 0) {
        pendingPreludeNodes.push(node);
        return;
      }

      rounds[rounds.length - 1].nodes.push(node);
    });

    if (pendingPreludeNodes.length > 0) {
      if (rounds.length > 0) {
        rounds[0].nodes.unshift(...pendingPreludeNodes);
      } else {
        rounds.push({
          index: 1,
          nodes: [...pendingPreludeNodes],
          userNode: null,
        });
      }
    }

    return rounds.filter(({ nodes: roundNodes }) => roundNodes.length > 0);
  };

  const getConversationRoundSummary = (nodes = getAllConversationNodes()) => {
    const rounds = buildConversationRounds(nodes);
    const clampedVisibleRoundCount = Math.max(1, state.visibleRoundCount);
    const hiddenRoundCount = Math.max(0, rounds.length - clampedVisibleRoundCount);

    return {
      rounds,
      totalRounds: rounds.length,
      visibleRoundCount: rounds.length - hiddenRoundCount,
      hiddenRoundCount,
    };
  };

  const restoreNodesInConversationOrder = (nodesToRestore, orderedNodes, collapsedNodeMap) => {
    const restoreSet = new Set(nodesToRestore);

    for (let index = orderedNodes.length - 1; index >= 0; index -= 1) {
      const node = orderedNodes[index];
      if (!restoreSet.has(node) || document.contains(node)) {
        continue;
      }

      const record = collapsedNodeMap.get(node);
      if (!record?.parent || !record.parent.isConnected) {
        continue;
      }

      let referenceNode = null;
      for (let nextIndex = index + 1; nextIndex < orderedNodes.length; nextIndex += 1) {
        const candidate = orderedNodes[nextIndex];
        if (candidate?.parentNode === record.parent) {
          referenceNode = candidate;
          break;
        }
      }

      if (referenceNode) {
        record.parent.insertBefore(node, referenceNode);
      } else {
        record.parent.appendChild(node);
      }
    }
  };

  const syncCollapsedNodes = (targetHiddenNodes, orderedNodes) => {
    const currentCollapsedRecords = state.collapsedNodes.filter(({ node }) => Boolean(node));
    const currentCollapsedMap = new Map(
      currentCollapsedRecords.map((record) => [record.node, record])
    );
    const targetHiddenSet = new Set(targetHiddenNodes);

    const nodesToRestore = currentCollapsedRecords
      .map((record) => record.node)
      .filter((node) => !targetHiddenSet.has(node));

    if (nodesToRestore.length > 0) {
      restoreNodesInConversationOrder(nodesToRestore, orderedNodes, currentCollapsedMap);
    }

    const nextCollapsedMap = new Map();
    targetHiddenNodes.forEach((node) => {
      const existingRecord = currentCollapsedMap.get(node);
      if (existingRecord) {
        nextCollapsedMap.set(node, existingRecord);
        return;
      }

      if (node?.parentNode) {
        nextCollapsedMap.set(node, {
          node,
          parent: node.parentNode,
        });
      }
    });

    targetHiddenNodes.forEach((node) => {
      if (currentCollapsedMap.has(node)) {
        return;
      }

      const record = nextCollapsedMap.get(node);
      if (!record?.parent) {
        return;
      }

      node.remove();
    });

    state.collapsedNodes = targetHiddenNodes
      .map((node) => nextCollapsedMap.get(node))
      .filter(Boolean);
    state.isCollapsed = state.collapsedNodes.length > 0;
  };

  const applyConversationFoldState = (visibleRoundCount = state.visibleRoundCount) => {
    ensureConversationState();

    const normalizedVisibleRoundCount = Math.max(
      1,
      Number.parseInt(String(visibleRoundCount), 10) || DEFAULT_VISIBLE_ROUNDS
    );
    state.visibleRoundCount = normalizedVisibleRoundCount;

    const allNodes = getAllConversationNodes();
    const rounds = buildConversationRounds(allNodes);
    const hiddenRoundCount = Math.max(0, rounds.length - normalizedVisibleRoundCount);
    const targetHiddenNodes =
      hiddenRoundCount > 0
        ? rounds.slice(0, hiddenRoundCount).flatMap(({ nodes: roundNodes }) => roundNodes)
        : [];

    syncCollapsedNodes(targetHiddenNodes, allNodes);
    renderCollapseToggleControl();

    return {
      totalRounds: rounds.length,
      visibleRoundCount: rounds.length - hiddenRoundCount,
      hiddenRoundCount,
      hiddenNodeCount: targetHiddenNodes.length,
    };
  };

  const foldConversationConvs = () => {
    const result = applyConversationFoldState(DEFAULT_VISIBLE_ROUNDS);

    if (result.totalRounds === 0) {
      updateStatus("当前会话尚未加载完成。", "info");
      return;
    }

    if (result.hiddenRoundCount === 0) {
      updateStatus(`当前会话不足 ${DEFAULT_VISIBLE_ROUNDS} 轮，无需折叠。`, "info");
      return;
    }

    updateStatus(`已折叠，仅保留最新 ${result.visibleRoundCount} 轮对话。`, "success");
  };

  const getUnfoldRoundsInput = () => document.getElementById(UNFOLD_ROUNDS_INPUT_ID);

  const sanitizeUnfoldRoundsInput = (input, commit = false) => {
    if (!(input instanceof HTMLInputElement)) {
      return DEFAULT_VISIBLE_ROUNDS;
    }

    const digitsOnly = input.value.replace(/\D+/g, "").replace(/^0+/, "");
    if (!digitsOnly) {
      if (commit) {
        input.value = String(DEFAULT_VISIBLE_ROUNDS);
      } else {
        input.value = "";
      }
      return DEFAULT_VISIBLE_ROUNDS;
    }

    input.value = digitsOnly;
    return Number.parseInt(digitsOnly, 10);
  };

  const readUnfoldRoundsInputValue = () => {
    const input = getUnfoldRoundsInput();
    return sanitizeUnfoldRoundsInput(input, true);
  };

  const renderUnfoldRoundsInput = () => {
    const input = getUnfoldRoundsInput();
    if (!input) {
      return;
    }
    sanitizeUnfoldRoundsInput(input, true);
  };

  const unfoldConversationRounds = () => {
    ensureConversationState();
    const before = getConversationRoundSummary();
    if (before.totalRounds === 0) {
      updateStatus("当前会话尚未加载完成。", "info");
      return;
    }

    const unfoldRounds = readUnfoldRoundsInputValue();
    const nextVisibleRoundCount = before.visibleRoundCount + unfoldRounds;
    const result = applyConversationFoldState(nextVisibleRoundCount);
    const expandedRoundCount = result.visibleRoundCount - before.visibleRoundCount;

    if (expandedRoundCount <= 0) {
      updateStatus("没有更多可展开的对话轮次。", "info");
      return;
    }

    updateStatus(`已向上展开 ${expandedRoundCount} 轮对话。`, "success");
  };

  const isScrollableElement = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY || style.overflow;
    return /(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight + 4;
  };

  const getExplicitGeminiScrollContainer = (node) => {
    if (!IS_GEMINI) {
      return null;
    }

    const candidates = [
      document.querySelector('[data-test-id="chat-history-container"]'),
      document.getElementById("chat-history"),
    ].filter(isHTMLElement);

    return candidates.find((element) => element.contains(node) && isScrollableElement(element)) || null;
  };

  const getScrollContainer = (node) => {
    const explicitGeminiContainer = getExplicitGeminiScrollContainer(node);
    if (explicitGeminiContainer) {
      return explicitGeminiContainer;
    }

    let current = node instanceof HTMLElement ? node.parentElement : null;
    while (current && current !== document.body) {
      if (isScrollableElement(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };

  const isDocumentScrollContainer = (container) =>
    container === document.scrollingElement ||
    container === document.documentElement ||
    container === document.body;

  const getNodeTopInContainer = (node, container) => {
    const nodeRect = node.getBoundingClientRect();
    if (isDocumentScrollContainer(container)) {
      return nodeRect.top;
    }
    return nodeRect.top - container.getBoundingClientRect().top;
  };

  const getUserMessageAnchors = () => {
    if (IS_GEMINI) {
      return getMessageNodes()
        .map((node) => {
          const userQuery = node.querySelector("user-query");
          const anchorNode =
            userQuery?.querySelector(".user-query-bubble-with-background") ||
            userQuery?.querySelector(".query-content") ||
            userQuery;
          return {
            node: anchorNode,
            highlightNode: anchorNode,
            role: "user",
            text: extractMessageText(userQuery),
          };
        })
        .filter(({ node, text }) => Boolean(node) && Boolean(text));
    }

    return getMessageNodes()
      .map((node) => {
        const roleNode = getChatGptRoleNode(node);
        const role = node.getAttribute("data-turn") || detectRole(roleNode);
        return {
          node,
          role,
          text: extractMessageText(roleNode),
        };
      })
      .filter(({ role, text }) => role === "user" && Boolean(text));
  };

  const clearJumpHighlight = () => {
    if (state.highlightedMessageNode?.classList) {
      state.highlightedMessageNode.classList.remove("chatgpt-toolkit-jump-highlight");
    }
    state.highlightedMessageNode = null;
    if (state.jumpHighlightTimer) {
      window.clearTimeout(state.jumpHighlightTimer);
      state.jumpHighlightTimer = null;
    }
  };

  const highlightJumpTarget = (node) => {
    clearJumpHighlight();
    node.classList.add("chatgpt-toolkit-jump-highlight");
    state.highlightedMessageNode = node;
    state.jumpHighlightTimer = window.setTimeout(() => {
      if (node.classList) {
        node.classList.remove("chatgpt-toolkit-jump-highlight");
      }
      if (state.highlightedMessageNode === node) {
        state.highlightedMessageNode = null;
      }
      state.jumpHighlightTimer = null;
    }, 1800);
  };

  const scrollToMessageNode = (node, container, highlightNode = node) => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = prefersReducedMotion ? "auto" : "smooth";

    if (isDocumentScrollContainer(container)) {
      const targetTop = Math.max(
        0,
        window.scrollY + node.getBoundingClientRect().top - NAVIGATION_TARGET_OFFSET
      );
      window.scrollTo({ top: targetTop, behavior });
    } else {
      const targetTop = Math.max(
        0,
        container.scrollTop + getNodeTopInContainer(node, container) - NAVIGATION_TARGET_OFFSET
      );
      container.scrollTo({ top: targetTop, behavior });
    }
    highlightJumpTarget(highlightNode);
  };

  const navigateUserMessage = (direction) => {
    const switchedConversation = ensureConversationState();
    if (switchedConversation) {
      clearJumpHighlight();
    }

    const userAnchors = getUserMessageAnchors();
    if (userAnchors.length === 0) {
      updateStatus("当前会话中没有可定位的用户消息。", "info");
      return;
    }

    const scrollContainer = getScrollContainer(userAnchors[0].node);
    let targetAnchor = null;

    if (direction === "up") {
      for (let index = userAnchors.length - 1; index >= 0; index -= 1) {
        const top = getNodeTopInContainer(userAnchors[index].node, scrollContainer);
        if (top < NAVIGATION_TARGET_LINE - NAVIGATION_TOLERANCE) {
          targetAnchor = userAnchors[index];
          break;
        }
      }
    } else {
      targetAnchor =
        userAnchors.find(
          ({ node }) =>
            getNodeTopInContainer(node, scrollContainer) >
            NAVIGATION_TARGET_LINE + NAVIGATION_TOLERANCE
        ) || null;
    }

    if (!targetAnchor) {
      if (direction === "up" && state.collapsedNodes.length > 0) {
        updateStatus("已经到达当前展开区域的第一轮用户消息，可使用 Unfold 展开更多。", "info");
      } else {
        updateStatus(
          direction === "up" ? "已经到达第一轮用户消息。" : "已经到达最后一轮用户消息。",
          "info"
        );
      }
      return;
    }

    scrollToMessageNode(
      targetAnchor.node,
      scrollContainer,
      targetAnchor.highlightNode || targetAnchor.node
    );
    updateStatus(
      direction === "up" ? "已跳转到上一轮用户消息。" : "已跳转到下一轮用户消息。",
      "success"
    );
  };

  const exportMessages = () => {
    ensureConversationState();
    const nodesForExport = getAllConversationNodes();
    const messages = buildMessagePayload(nodesForExport);

    const payload = {
      site: PRODUCT_NAME,
      exportedAt: new Date().toISOString(),
      url: window.location.href,
      messageCount: messages.length,
      messages,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });

    const dateTag = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${EXPORT_FILENAME_PREFIX}-${dateTag}.json`;

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);

    updateStatus("导出已开始，请检查下载文件。", "success");
  };

  const isConversationHref = (href = "") =>
    IS_GEMINI ? /\/app\/[^/?#]+/.test(href) : /\/c\/[^/?#]+/.test(href);

  const getHistoryContainer = () => {
    if (IS_GEMINI) {
      return (
        document.querySelector('[id^="conversations-list-"]') ||
        document.querySelector(".conversations-container") ||
        Array.from(document.querySelectorAll("nav, aside")).find((container) =>
          container.querySelector(GEMINI_SIDEBAR_LINK_SELECTOR)
        ) ||
        null
      );
    }

    const explicitHistory = document.querySelector('[id^="history"]');
    if (explicitHistory) {
      return explicitHistory;
    }

    return (
      Array.from(document.querySelectorAll("nav, aside")).find((container) =>
        Array.from(container.querySelectorAll("a[href]")).some((link) =>
          isConversationHref(link.getAttribute("href") || "")
        )
      ) || null
    );
  };

  const getConversationUrl = (link) => {
    const href = link?.getAttribute("href");
    if (!href || !isConversationHref(href)) {
      return "";
    }

    try {
      const url = new URL(href, window.location.origin);
      return `${url.origin}${url.pathname}`;
    } catch (error) {
      return href;
    }
  };

  const getConversationRow = (link) => {
    if (IS_GEMINI) {
      return link.closest(GEMINI_SIDEBAR_ROW_SELECTOR) || link.parentElement || link;
    }
    return link.closest('[data-sidebar-item="true"]') || link.closest("li") || link;
  };

  const getConversationTitle = (link) => {
    if (IS_GEMINI) {
      const explicitTitle = link.querySelector(".conversation-title");
      if (explicitTitle?.textContent?.trim()) {
        return explicitTitle.textContent.trim();
      }
    } else {
      const explicitTitle = link.querySelector(".relative.grow.overflow-hidden.whitespace-nowrap");
      if (explicitTitle?.textContent?.trim()) {
        return explicitTitle.textContent.trim();
      }
    }

    const ariaLabel = link.getAttribute("aria-label");
    if (ariaLabel) {
      return collapseWhitespace(ariaLabel);
    }

    return collapseWhitespace(link.textContent || "") || "未命名 conversation";
  };

  const getConversationLinks = () => {
    const history = getHistoryContainer();
    if (!history) {
      return [];
    }

    const selector = IS_GEMINI ? GEMINI_SIDEBAR_LINK_SELECTOR : 'a[href]';
    return dedupeElements(
      Array.from(history.querySelectorAll(selector)).filter((link) => {
        const key = getConversationUrl(link);
        return Boolean(key) && isVisible(link);
      }),
      (link) => getConversationUrl(link)
    );
  };

  const getBulkDeleteButton = () => document.getElementById(BULK_DELETE_BUTTON_ID);
  const getBulkDeletePopover = () => document.getElementById(BULK_DELETE_POPOVER_ID);
  const getCollapseToggleButton = () => document.getElementById(COLLAPSE_TOGGLE_BUTTON_ID);
  const getToolkitAnchor = () => document.getElementById(TOOLKIT_ANCHOR_ID);
  const getHoverNavigationPopover = () => document.getElementById(HOVER_NAVIGATION_ID);

  const clearHoverNavigationHideTimer = () => {
    if (state.hoverNavigationHideTimer) {
      window.clearTimeout(state.hoverNavigationHideTimer);
      state.hoverNavigationHideTimer = null;
    }
  };

  const renderHoverNavigationVisibility = () => {
    const anchor = getToolkitAnchor();
    const popover = getHoverNavigationPopover();
    if (!anchor || !popover) {
      return;
    }

    const shouldShow = state.isMinimized && state.hoverNavigationVisible;
    anchor.classList.toggle("is-hover-navigation-visible", shouldShow);
    popover.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    updateHoverNavigationPlacement();
  };

  const showHoverNavigation = () => {
    if (!state.isMinimized) {
      return;
    }

    clearHoverNavigationHideTimer();
    if (!state.hoverNavigationVisible) {
      state.hoverNavigationVisible = true;
      renderHoverNavigationVisibility();
    }
  };

  const hideHoverNavigation = () => {
    clearHoverNavigationHideTimer();
    if (!state.hoverNavigationVisible) {
      return;
    }

    state.hoverNavigationVisible = false;
    renderHoverNavigationVisibility();
  };

  const scheduleHideHoverNavigation = () => {
    clearHoverNavigationHideTimer();
    hideHoverNavigation();
  };

  const renderCollapseToggleControl = () => {
    const button = getCollapseToggleButton();
    if (!button) {
      return;
    }
    button.textContent = "Fold Convs";
    button.setAttribute("aria-label", "Fold Convs");
  };

  const removeBulkDeleteDecorations = () => {
    document.querySelectorAll(`.${SIDEBAR_CHECKBOX_HOST_CLASS}`).forEach((element) => element.remove());
    document.querySelectorAll(`.${SIDEBAR_ROW_CLASS}`).forEach((element) => {
      element.classList.remove(SIDEBAR_ROW_CLASS);
      delete element.dataset.chatgptToolkitConversationKey;
    });
    document.querySelectorAll(`.${SIDEBAR_LINK_CLASS}`).forEach((element) => {
      element.classList.remove(SIDEBAR_LINK_CLASS);
      delete element.dataset.chatgptToolkitConversationKey;
    });
  };

  const renderBulkDeleteControls = () => {
    const button = getBulkDeleteButton();
    const popover = getBulkDeletePopover();
    const summary = document.getElementById(BULK_DELETE_SUMMARY_ID);

    if (button) {
      button.classList.toggle("is-active", state.bulkDeleteMode);
      button.disabled = state.isDeletingConversations;
      button.setAttribute("aria-pressed", state.bulkDeleteMode ? "true" : "false");
      button.textContent = state.bulkDeleteMode ? "退出批量删除" : "批量删除 conversation";
    }

    if (popover) {
      popover.hidden = !state.bulkDeleteMode;
      popover.classList.toggle("is-visible", state.bulkDeleteMode);
    }

    if (summary) {
      summary.textContent = `${state.selectedConversationKeys.size}`;
    }

    const actions = document.querySelectorAll(
      `#${BULK_DELETE_POPOVER_ID} [data-role="bulk-action"]`
    );
    actions.forEach((actionButton) => {
      const element = actionButton;
      const action = element.dataset.action;
      if (action === "prompt-bulk-delete") {
        element.disabled =
          state.isDeletingConversations || state.selectedConversationKeys.size === 0;
        element.textContent = state.isDeletingConversations ? "删除中..." : "一键删除";
        return;
      }
      element.disabled = state.isDeletingConversations;
    });
  };

  const handleSidebarCheckboxChange = (event) => {
    const checkbox = event.currentTarget;
    if (!(checkbox instanceof HTMLInputElement)) {
      return;
    }

    const key = checkbox.dataset.conversationKey;
    if (!key) {
      return;
    }

    if (checkbox.checked) {
      state.selectedConversationKeys.add(key);
    } else {
      state.selectedConversationKeys.delete(key);
    }
    renderBulkDeleteControls();
  };

  const ensureSidebarCheckbox = (link) => {
    const row = getConversationRow(link);
    const key = getConversationUrl(link);
    if (!row || !key) {
      return;
    }

    row.classList.add(SIDEBAR_ROW_CLASS);
    row.dataset.chatgptToolkitConversationKey = key;
    link.classList.add(SIDEBAR_LINK_CLASS);
    link.dataset.chatgptToolkitConversationKey = key;

    let host = row.querySelector(`.${SIDEBAR_CHECKBOX_HOST_CLASS}`);
    if (!host) {
      host = document.createElement("div");
      host.className = SIDEBAR_CHECKBOX_HOST_CLASS;
      ["click", "mousedown", "mouseup", "pointerdown", "pointerup"].forEach((type) => {
        host.addEventListener(type, (event) => event.stopPropagation());
      });
      row.appendChild(host);
    }

    let checkbox = host.querySelector(`.${SIDEBAR_CHECKBOX_CLASS}`);
    if (!checkbox) {
      checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = SIDEBAR_CHECKBOX_CLASS;
      checkbox.addEventListener("change", handleSidebarCheckboxChange);
      ["click", "mousedown", "mouseup", "pointerdown", "pointerup"].forEach((type) => {
        checkbox.addEventListener(type, (event) => event.stopPropagation());
      });
      host.appendChild(checkbox);
    }

    checkbox.dataset.conversationKey = key;
    checkbox.checked = state.selectedConversationKeys.has(key);
    checkbox.disabled = state.isDeletingConversations;
    checkbox.setAttribute("aria-label", `选择 conversation：${getConversationTitle(link)}`);
  };

  const syncBulkDeleteCheckboxes = () => {
    if (!state.bulkDeleteMode) {
      return;
    }

    const links = getConversationLinks();
    const renderedKeys = new Set(links.map((link) => getConversationUrl(link)).filter(Boolean));

    state.selectedConversationKeys = new Set(
      Array.from(state.selectedConversationKeys).filter((key) => renderedKeys.has(key))
    );

    document.querySelectorAll(`.${SIDEBAR_CHECKBOX_HOST_CLASS}`).forEach((host) => {
      const row = host.parentElement;
      const key = row?.dataset.chatgptToolkitConversationKey;
      if (!row || !key || !renderedKeys.has(key)) {
        host.remove();
        if (row) {
          row.classList.remove(SIDEBAR_ROW_CLASS);
          delete row.dataset.chatgptToolkitConversationKey;
        }
      }
    });

    document.querySelectorAll(`.${SIDEBAR_LINK_CLASS}`).forEach((link) => {
      const key = link.dataset.chatgptToolkitConversationKey || getConversationUrl(link);
      if (!key || !renderedKeys.has(key)) {
        link.classList.remove(SIDEBAR_LINK_CLASS);
        delete link.dataset.chatgptToolkitConversationKey;
      }
    });

    links.forEach((link) => ensureSidebarCheckbox(link));
    renderBulkDeleteControls();
  };

  const scheduleBulkDeleteSync = () => {
    if (!state.bulkDeleteMode || state.bulkDeleteSyncQueued) {
      return;
    }
    state.bulkDeleteSyncQueued = true;
    window.requestAnimationFrame(() => {
      state.bulkDeleteSyncQueued = false;
      syncBulkDeleteCheckboxes();
    });
  };

  const clearBulkDeleteSelection = (message = "已取消全部选择。") => {
    state.selectedConversationKeys.clear();
    syncBulkDeleteCheckboxes();
    updateStatus(message, "info");
  };

  const selectAllRenderedConversations = () => {
    const links = getConversationLinks();
    if (links.length === 0) {
      updateStatus("当前左侧栏没有可选的 conversation。", "info");
      return;
    }
    links.forEach((link) => {
      const key = getConversationUrl(link);
      if (key) {
        state.selectedConversationKeys.add(key);
      }
    });
    syncBulkDeleteCheckboxes();
    updateStatus(`已全选当前已渲染的 ${links.length} 个 conversation。`, "success");
  };

  const ensureConfirmDialog = () => {
    const existing = document.getElementById(CONFIRM_DIALOG_ID);
    if (existing) {
      return existing;
    }

    const overlay = document.createElement("div");
    overlay.id = CONFIRM_DIALOG_ID;
    overlay.className = "chatgpt-toolkit-confirm-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="chatgpt-toolkit-confirm-card" role="dialog" aria-modal="true" aria-labelledby="chatgpt-toolkit-confirm-title">
        <h3 id="chatgpt-toolkit-confirm-title" class="chatgpt-toolkit-confirm-title">确认批量删除</h3>
        <p class="chatgpt-toolkit-confirm-message" data-role="confirm-message"></p>
        <div class="chatgpt-toolkit-confirm-actions">
          <button type="button" class="chatgpt-toolkit-dialog-button secondary" data-action="cancel-bulk-delete-confirm">
            取消
          </button>
          <button type="button" class="chatgpt-toolkit-dialog-button danger" data-action="confirm-bulk-delete-confirm">
            确认删除
          </button>
        </div>
      </div>
    `;

    overlay.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const actionTarget = target.closest("[data-action]");
      const action = actionTarget?.dataset.action;

      if (target === overlay || action === "cancel-bulk-delete-confirm") {
        hideDeleteConfirmDialog();
      }

      if (action === "confirm-bulk-delete-confirm") {
        hideDeleteConfirmDialog();
        void performBulkDelete();
      }
    });

    document.body.appendChild(overlay);
    return overlay;
  };

  const hideDeleteConfirmDialog = () => {
    const dialog = document.getElementById(CONFIRM_DIALOG_ID);
    if (!dialog) {
      return;
    }
    dialog.hidden = true;
    dialog.classList.remove("is-visible");
  };

  const showDeleteConfirmDialog = (count) => {
    const dialog = ensureConfirmDialog();
    const message = dialog.querySelector('[data-role="confirm-message"]');
    if (message) {
      message.textContent = `确认删除当前选中的 ${count} 个 conversation 吗？此操作不可撤销。`;
    }
    dialog.hidden = false;
    dialog.classList.add("is-visible");
  };

  const getSelectedRenderedConversationTargets = () =>
    getConversationLinks()
      .filter((link) => state.selectedConversationKeys.has(getConversationUrl(link)))
      .map((link) => ({
        key: getConversationUrl(link),
        title: getConversationTitle(link),
        link,
        row: getConversationRow(link),
      }));

  const getConversationActionButton = (row) => {
    if (!row) {
      return null;
    }

    if (IS_GEMINI) {
      const geminiButton = row.querySelector('button[data-test-id="actions-menu-button"]');
      if (geminiButton && isVisible(geminiButton)) {
        return geminiButton;
      }
    }

    const buttons = Array.from(row.querySelectorAll("button")).filter(
      (button) =>
        isVisible(button) &&
        !button.closest(`#${TOOLKIT_ID}`) &&
        !button.closest(`.${SIDEBAR_CHECKBOX_HOST_CLASS}`)
    );

    return (
      buttons.find((button) => {
        const label = getAccessibleText(button);
        return textIncludes(label, OPTIONS_TEXTS) || button.getAttribute("aria-haspopup") === "menu";
      }) ||
      buttons.at(-1) ||
      null
    );
  };

  const getVisibleInteractiveOverlays = () =>
    Array.from(
      document.querySelectorAll(
        [
          ".cdk-overlay-pane",
          ".mat-mdc-menu-panel",
          "mat-dialog-container",
          "[role='menu']",
          "[role='dialog']",
          "[aria-modal='true']",
          "[data-radix-popper-content-wrapper]",
        ].join(", ")
      )
    ).filter((element) => isVisible(element) && !element.closest(`#${TOOLKIT_ID}`));

  const findDeleteMenuItem = () => {
    const scopes = getVisibleInteractiveOverlays();
    const candidates = scopes.length
      ? scopes.flatMap((scope) =>
          Array.from(
            scope.querySelectorAll(
              "button, [role='menuitem'], [role='option'], a[href], li, .mat-mdc-menu-item"
            )
          )
        )
      : Array.from(document.querySelectorAll("button, [role='menuitem'], .mat-mdc-menu-item"));

    return (
      candidates.find((item) => {
        if (!isVisible(item)) {
          return false;
        }
        const text = getAccessibleText(item);
        return textIncludes(text, DELETE_MENU_TEXTS) && !textIncludes(text, CANCEL_TEXTS);
      }) ||
      candidates.find((item) => {
        if (!isVisible(item)) {
          return false;
        }
        return /danger|destructive|error|warn|delete/i.test(
          `${item.className} ${item.getAttribute("data-mdc-dialog-action") || ""}`
        );
      }) ||
      null
    );
  };

  const findDeleteConfirmButton = () => {
    const dialogRoots = Array.from(
      document.querySelectorAll(
        "[role='dialog'], [aria-modal='true'], mat-dialog-container, .cdk-overlay-pane"
      )
    ).filter(
      (element) =>
        isVisible(element) &&
        !element.closest(`#${TOOLKIT_ID}`) &&
        (element.matches("[role='dialog'], [aria-modal='true'], mat-dialog-container") ||
          element.querySelector("[role='dialog'], [aria-modal='true'], mat-dialog-container"))
    );

    for (const dialog of dialogRoots) {
      const buttons = Array.from(dialog.querySelectorAll("button")).filter((button) =>
        isVisible(button)
      );

      const exactMatch = buttons.find((button) => {
        const text = getAccessibleText(button);
        return textIncludes(text, DELETE_CONFIRM_TEXTS) && !textIncludes(text, CANCEL_TEXTS);
      });
      if (exactMatch) {
        return exactMatch;
      }

      const dangerButton = buttons.find((button) =>
        /danger|destructive|error|warn|delete|critical/i.test(
          `${button.className} ${button.getAttribute("data-mdc-dialog-action") || ""} ${
            button.getAttribute("color") || ""
          }`
        )
      );
      if (dangerButton) {
        return dangerButton;
      }

      if (buttons.length === 2) {
        const cancelButton = buttons.find((button) =>
          textIncludes(getAccessibleText(button), CANCEL_TEXTS)
        );
        if (cancelButton) {
          return buttons.find((button) => button !== cancelButton) || null;
        }
      }
    }

    return null;
  };

  const deleteConversationTarget = async (target) => {
    if (!target.row || !document.contains(target.row)) {
      return false;
    }

    hoverElement(target.row);
    hoverElement(target.link);
    await delay(180);

    const actionButton = await waitForValue(() => getConversationActionButton(target.row), 2200, 80);
    if (!actionButton) {
      return false;
    }

    triggerElementClick(actionButton);
    await delay(220);

    const deleteMenuItem = await waitForValue(findDeleteMenuItem, 2400, 80);
    if (!deleteMenuItem) {
      return false;
    }

    triggerElementClick(deleteMenuItem);

    const confirmButton = await waitForValue(findDeleteConfirmButton, 3200, 80);
    if (!confirmButton) {
      return false;
    }

    triggerElementClick(confirmButton);

    const removed = await waitForValue(() => {
      const stillExists = getConversationLinks().some(
        (link) => getConversationUrl(link) === target.key
      );
      return stillExists ? null : true;
    }, 6000, 120);

    return Boolean(removed);
  };

  const performBulkDelete = async () => {
    if (state.isDeletingConversations) {
      return;
    }

    const targets = getSelectedRenderedConversationTargets();
    if (targets.length === 0) {
      updateStatus("请先勾选需要删除的 conversation。", "info");
      return;
    }

    state.isDeletingConversations = true;
    renderBulkDeleteControls();
    syncBulkDeleteCheckboxes();

    let successCount = 0;
    let failedCount = 0;

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      updateStatus(
        `正在删除 ${index + 1}/${targets.length}：${truncateText(target.title, 18)}`,
        "info"
      );

      try {
        const success = await deleteConversationTarget(target);
        if (success) {
          successCount += 1;
          state.selectedConversationKeys.delete(target.key);
        } else {
          failedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
      }

      await delay(220);
      syncBulkDeleteCheckboxes();
    }

    state.isDeletingConversations = false;
    renderBulkDeleteControls();
    syncBulkDeleteCheckboxes();

    if (failedCount === 0) {
      updateStatus(`批量删除完成：已删除 ${successCount} 个 conversation。`, "success");
      return;
    }

    updateStatus(
      `批量删除完成：成功 ${successCount} 个，失败 ${failedCount} 个。`,
      "warning"
    );
  };

  const requestBulkDeleteConfirmation = () => {
    if (state.isDeletingConversations) {
      return;
    }

    const count = getSelectedRenderedConversationTargets().length;
    if (count === 0) {
      updateStatus("请先勾选需要删除的 conversation。", "info");
      return;
    }

    showDeleteConfirmDialog(count);
  };

  const toggleBulkDeleteMode = () => {
    if (state.isDeletingConversations) {
      return;
    }

    state.bulkDeleteMode = !state.bulkDeleteMode;

    if (!state.bulkDeleteMode) {
      state.selectedConversationKeys.clear();
      removeBulkDeleteDecorations();
      hideDeleteConfirmDialog();
      renderBulkDeleteControls();
      updateStatus("已退出批量删除模式。", "info");
      return;
    }

    syncBulkDeleteCheckboxes();
    renderBulkDeleteControls();

    const links = getConversationLinks();
    if (links.length > 0) {
      updateStatus("批量删除模式已开启，请勾选左侧 conversation。", "info");
    } else {
      updateStatus("批量删除模式已开启，等待左侧会话列表加载。", "info");
    }
  };

  const buildToolbar = () => {
    const container = document.createElement("section");
    container.id = TOOLKIT_ID;
    container.innerHTML = `
      <div class="chatgpt-toolkit-header">
        <strong>${TOOLKIT_TITLE}</strong>
        <button type="button" class="chatgpt-toolkit-minimize" data-action="minimize" aria-label="收起工具">
          收起
        </button>
      </div>
      <div class="chatgpt-toolkit-actions">
        <button type="button" id="${COLLAPSE_TOGGLE_BUTTON_ID}" class="chatgpt-toolkit-button" data-action="fold-conversations">
          Fold Convs
        </button>
        <div class="chatgpt-toolkit-button-row chatgpt-toolkit-inline-action">
          <button type="button" class="chatgpt-toolkit-button" data-action="unfold-rounds">
            Unfold
          </button>
          <input
            type="text"
            id="${UNFOLD_ROUNDS_INPUT_ID}"
            class="chatgpt-toolkit-round-input"
            inputmode="numeric"
            pattern="[0-9]*"
            value="${DEFAULT_VISIBLE_ROUNDS}"
            aria-label="展开轮数"
          />
        </div>
        <button type="button" class="chatgpt-toolkit-button primary" data-action="export">
          一键导出
        </button>
        <div class="chatgpt-toolkit-divider" aria-hidden="true"></div>
        <div class="chatgpt-toolkit-bulk-entry">
          <button type="button" id="${BULK_DELETE_BUTTON_ID}" class="chatgpt-toolkit-button danger" data-action="toggle-bulk-delete" aria-pressed="false">
            批量删除 conversation
          </button>
          <div id="${BULK_DELETE_POPOVER_ID}" class="chatgpt-toolkit-bulk-popover" hidden>
            <p class="chatgpt-toolkit-bulk-summary">已选 <span id="${BULK_DELETE_SUMMARY_ID}">0</span> 项</p>
            <button type="button" class="chatgpt-toolkit-mini-button" data-action="select-all" data-role="bulk-action">
              全选
            </button>
            <button type="button" class="chatgpt-toolkit-mini-button" data-action="clear-all" data-role="bulk-action">
              取消全选
            </button>
            <button type="button" class="chatgpt-toolkit-mini-button danger" data-action="prompt-bulk-delete" data-role="bulk-action">
              一键删除
            </button>
          </div>
        </div>
      </div>
      <p id="${STATUS_ID}" class="chatgpt-toolkit-status" data-tone="info">准备就绪。</p>
    `;

    container.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const actionTarget = target.closest("[data-action]");
      if (!(actionTarget instanceof HTMLElement)) {
        return;
      }

      const action = actionTarget.dataset.action;
      if (!action) {
        return;
      }

      handleToolkitAction(action);
    });

    container.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.id !== UNFOLD_ROUNDS_INPUT_ID) {
        return;
      }

      sanitizeUnfoldRoundsInput(target, false);
    });

    container.addEventListener(
      "blur",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.id !== UNFOLD_ROUNDS_INPUT_ID) {
          return;
        }

        sanitizeUnfoldRoundsInput(target, true);
      },
      true
    );

    return container;
  };

  const handleToolkitAction = (action) => {
    if (action === "minimize") {
      minimizeToolbar();
    }
    if (action === "fold-conversations") {
      foldConversationConvs();
    }
    if (action === "unfold-rounds") {
      unfoldConversationRounds();
    }
    if (action === "jump-user-up") {
      navigateUserMessage("up");
    }
    if (action === "jump-user-down") {
      navigateUserMessage("down");
    }
    if (action === "export") {
      exportMessages();
    }
    if (action === "toggle-bulk-delete") {
      toggleBulkDeleteMode();
    }
    if (action === "select-all") {
      selectAllRenderedConversations();
    }
    if (action === "clear-all") {
      clearBulkDeleteSelection();
    }
    if (action === "prompt-bulk-delete") {
      requestBulkDeleteConfirmation();
    }
  };

  const buildHoverNavigationPopover = () => {
    const container = document.createElement("div");
    container.id = HOVER_NAVIGATION_ID;
    container.className = "chatgpt-toolkit-hover-navigation";
    container.setAttribute("aria-hidden", "true");
    container.innerHTML = `
      <button type="button" class="chatgpt-toolkit-hover-nav-button" data-action="jump-user-up">
        上一轮
      </button>
      <button type="button" class="chatgpt-toolkit-hover-nav-button" data-action="jump-user-down">
        下一轮
      </button>
    `;

    container.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const actionTarget = target.closest("[data-action]");
      if (!(actionTarget instanceof HTMLElement)) {
        return;
      }

      const action = actionTarget.dataset.action;
      if (!action) {
        return;
      }

      handleToolkitAction(action);
    });

    return container;
  };

  const enableHoverNavigation = (button, popover) => {
    if (!button || !popover) {
      return;
    }

    const handlePointerEnter = () => {
      showHoverNavigation();
    };

    const handlePointerLeave = (event) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        (button.contains(nextTarget) || popover.contains(nextTarget))
      ) {
        return;
      }
      scheduleHideHoverNavigation();
    };

    [button, popover].forEach((element) => {
      element.addEventListener("pointerenter", handlePointerEnter);
      element.addEventListener("pointerleave", handlePointerLeave);
      element.addEventListener("focusin", handlePointerEnter);
      element.addEventListener("focusout", handlePointerLeave);
    });
  };

  const buildMinimizedButton = () => {
    const button = document.createElement("button");
    button.id = MINIMIZED_ID;
    button.type = "button";
    button.className = "chatgpt-toolkit-minimized";
    button.setAttribute("aria-label", `展开 ${TOOLKIT_TITLE}`);
    const iconUrl = IS_GEMINI ? GEMINI_ICON_URL : CHATGPT_ICON_URL;
    if (iconUrl) {
      button.style.backgroundImage = `url("${iconUrl}")`;
    }
    if (IS_GEMINI) {
      button.classList.add("is-gemini");
    }
    return button;
  };

  const buildToolkitAnchor = () => {
    const anchor = document.createElement("div");
    anchor.id = TOOLKIT_ANCHOR_ID;
    anchor.className = `${state.toolbarPlacement} nav-placement-left`;
    return anchor;
  };

  const applyMinimizedPosition = (anchor) => {
    const position = loadMinimizedPosition();
    if (!position) {
      ensureAnchorWithinViewport(anchor, false);
      return;
    }
    if (typeof position.left === "number" && typeof position.top === "number") {
      const nextPosition = getClampedAnchorPosition(anchor, position);
      applyAbsoluteAnchorPosition(anchor, nextPosition);
      saveMinimizedPosition(nextPosition);
    }
  };

  const updateToolbarPlacement = () => {
    const anchor = getToolkitAnchor();
    const toolbar = document.getElementById(TOOLKIT_ID);
    if (!anchor || !toolbar) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const toolbarWidth = toolbar.offsetWidth || 240;
    const toolbarHeight = toolbar.offsetHeight || toolbar.scrollHeight || 0;

    const placements = [
      {
        name: "placement-rd",
        fits:
          anchorRect.left + toolbarWidth <= window.innerWidth - TOOLKIT_VIEWPORT_MARGIN &&
          anchorRect.bottom + TOOLKIT_POPUP_GAP + toolbarHeight <=
            window.innerHeight - TOOLKIT_VIEWPORT_MARGIN,
        overflow:
          Math.max(
            0,
            anchorRect.left + toolbarWidth - (window.innerWidth - TOOLKIT_VIEWPORT_MARGIN)
          ) +
          Math.max(
            0,
            anchorRect.bottom + TOOLKIT_POPUP_GAP + toolbarHeight -
              (window.innerHeight - TOOLKIT_VIEWPORT_MARGIN)
          ),
      },
      {
        name: "placement-ld",
        fits:
          anchorRect.right - toolbarWidth >= TOOLKIT_VIEWPORT_MARGIN &&
          anchorRect.bottom + TOOLKIT_POPUP_GAP + toolbarHeight <=
            window.innerHeight - TOOLKIT_VIEWPORT_MARGIN,
        overflow:
          Math.max(0, TOOLKIT_VIEWPORT_MARGIN - (anchorRect.right - toolbarWidth)) +
          Math.max(
            0,
            anchorRect.bottom + TOOLKIT_POPUP_GAP + toolbarHeight -
              (window.innerHeight - TOOLKIT_VIEWPORT_MARGIN)
          ),
      },
      {
        name: "placement-ru",
        fits:
          anchorRect.left + toolbarWidth <= window.innerWidth - TOOLKIT_VIEWPORT_MARGIN &&
          anchorRect.top - TOOLKIT_POPUP_GAP - toolbarHeight >= TOOLKIT_VIEWPORT_MARGIN,
        overflow:
          Math.max(
            0,
            anchorRect.left + toolbarWidth - (window.innerWidth - TOOLKIT_VIEWPORT_MARGIN)
          ) +
          Math.max(
            0,
            TOOLKIT_VIEWPORT_MARGIN - (anchorRect.top - TOOLKIT_POPUP_GAP - toolbarHeight)
          ),
      },
      {
        name: "placement-lu",
        fits:
          anchorRect.right - toolbarWidth >= TOOLKIT_VIEWPORT_MARGIN &&
          anchorRect.top - TOOLKIT_POPUP_GAP - toolbarHeight >= TOOLKIT_VIEWPORT_MARGIN,
        overflow:
          Math.max(0, TOOLKIT_VIEWPORT_MARGIN - (anchorRect.right - toolbarWidth)) +
          Math.max(
            0,
            TOOLKIT_VIEWPORT_MARGIN - (anchorRect.top - TOOLKIT_POPUP_GAP - toolbarHeight)
          ),
      },
    ];

    const bestPlacement =
      placements.find((placement) => placement.fits) ||
      placements.reduce((best, placement) =>
        placement.overflow < best.overflow ? placement : best
      );

    state.toolbarPlacement = bestPlacement.name;
    anchor.classList.remove("placement-rd", "placement-ld", "placement-ru", "placement-lu");
    anchor.classList.add(bestPlacement.name);
  };

  const updateHoverNavigationPlacement = () => {
    const anchor = getToolkitAnchor();
    const hoverNavigation = getHoverNavigationPopover();
    if (!anchor || !hoverNavigation) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const popoverWidth = hoverNavigation.offsetWidth || 124;
    const availableRight = window.innerWidth - anchorRect.right - TOOLKIT_POPUP_GAP;
    const availableLeft = anchorRect.left - TOOLKIT_POPUP_GAP;
    const preferLeft = availableLeft >= popoverWidth || availableLeft >= availableRight;

    anchor.classList.toggle("nav-placement-left", preferLeft);
    anchor.classList.toggle("nav-placement-right", !preferLeft);
  };

  const renderToolbarVisibility = () => {
    const anchor = getToolkitAnchor();
    const toolbar = document.getElementById(TOOLKIT_ID);
    const minimized = document.getElementById(MINIMIZED_ID);
    if (!anchor || !toolbar || !minimized) {
      return;
    }

    toolbar.classList.toggle("is-expanded", !state.isMinimized);
    minimized.classList.toggle("is-active", !state.isMinimized);
    anchor.classList.toggle("is-toolbar-open", !state.isMinimized);
    minimized.setAttribute(
      "aria-label",
      state.isMinimized ? `展开 ${TOOLKIT_TITLE}` : `收起 ${TOOLKIT_TITLE}`
    );
    minimized.setAttribute("aria-expanded", state.isMinimized ? "false" : "true");

    updateHoverNavigationPlacement();
    if (!state.isMinimized) {
      hideHoverNavigation();
      updateToolbarPlacement();
      return;
    }

    renderHoverNavigationVisibility();
  };

  const minimizeToolbar = () => {
    if (state.isMinimized) {
      return;
    }
    state.isMinimized = true;
    renderToolbarVisibility();
  };

  const expandToolbar = () => {
    if (!state.isMinimized) {
      return;
    }
    state.isMinimized = false;
    renderToolbarVisibility();
  };

  const toggleToolbar = () => {
    if (state.isMinimized) {
      expandToolbar();
      return;
    }
    minimizeToolbar();
  };

  const enableDrag = (anchor, button) => {
    let isDragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onMouseMove = (event) => {
      if (!isDragging) {
        return;
      }

      moved = true;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      const nextPosition = getClampedAnchorPosition(anchor, {
        left: startLeft + deltaX,
        top: startTop + deltaY,
      });

      applyAbsoluteAnchorPosition(anchor, nextPosition);
      updateHoverNavigationPlacement();

      if (!state.isMinimized) {
        updateToolbarPlacement();
      }
    };

    const onMouseUp = () => {
      if (!isDragging) {
        return;
      }

      isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const nextPosition = ensureAnchorWithinViewport(anchor);
      if (nextPosition) {
        saveMinimizedPosition(nextPosition);
      }
      updateHoverNavigationPlacement();

      window.setTimeout(() => {
        moved = false;
      }, 0);
    };

    button.addEventListener("mousedown", (event) => {
      if (event.button !== 0) {
        return;
      }

      isDragging = true;
      moved = false;
      const rect = anchor.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      startX = event.clientX;
      startY = event.clientY;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    button.addEventListener("click", () => {
      if (moved) {
        return;
      }
      toggleToolbar();
    });
  };

  const attachToolbar = () => {
    if (document.getElementById(TOOLKIT_ID) || getToolkitAnchor()) {
      return;
    }

    const anchor = buildToolkitAnchor();
    const toolbar = buildToolbar();
    const hoverNavigation = buildHoverNavigationPopover();
    const minimizedButton = buildMinimizedButton();
    anchor.appendChild(toolbar);
    anchor.appendChild(hoverNavigation);
    anchor.appendChild(minimizedButton);
    document.body.appendChild(anchor);
    ensureConfirmDialog();
    applyMinimizedPosition(anchor);
    enableDrag(anchor, minimizedButton);
    enableHoverNavigation(minimizedButton, hoverNavigation);
    ensureConversationState();
    renderCollapseToggleControl();
    renderUnfoldRoundsInput();
    renderBulkDeleteControls();
    applyConversationFoldState(state.visibleRoundCount);
    updateHoverNavigationPlacement();
    renderToolbarVisibility();

    if (state.bulkDeleteMode) {
      scheduleBulkDeleteSync();
    }
  };

  attachToolbar();

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (state.isMinimized) {
        return;
      }

      const anchor = getToolkitAnchor();
      const dialog = document.getElementById(CONFIRM_DIALOG_ID);
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (state.bulkDeleteMode) {
        return;
      }
      if (
        anchor?.contains(target) ||
        dialog?.contains(target)
      ) {
        return;
      }
      minimizeToolbar();
    },
    true
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        hideDeleteConfirmDialog();
        if (!state.bulkDeleteMode) {
          minimizeToolbar();
        }
      }
    },
    true
  );

  window.addEventListener("resize", () => {
    const anchor = getToolkitAnchor();
    if (anchor) {
      ensureAnchorWithinViewport(anchor);
      updateHoverNavigationPlacement();
    }
    if (!state.isMinimized) {
      renderToolbarVisibility();
    }
  });

  const scheduleObservedDomRefresh = () => {
    if (state.observerRefreshQueued) {
      return;
    }

    state.observerRefreshQueued = true;
    window.setTimeout(() => {
      state.observerRefreshQueued = false;

      if (!getToolkitAnchor() || !document.getElementById(TOOLKIT_ID)) {
        attachToolbar();
      } else {
        ensureConversationState();
        applyConversationFoldState(state.visibleRoundCount);
      }

      if (state.bulkDeleteMode) {
        scheduleBulkDeleteSync();
      }
    }, OBSERVED_DOM_REFRESH_DELAY);
  };

  const observer = new MutationObserver((mutations) => {
    if (!shouldScheduleObservedDomRefresh(mutations)) {
      return;
    }
    scheduleObservedDomRefresh();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
