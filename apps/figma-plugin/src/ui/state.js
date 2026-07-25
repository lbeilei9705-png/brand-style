    <script>
      const apiBase = "https://brand-style.fintopia-social-media-ads-tools.tech";
      const defaultModelId = "nano-banana-pro";
      const modelSelect = document.querySelector("#model-select");
      const agentSelect = document.querySelector("#agent-select");
      const aspectRatioSelect = document.querySelector("#aspect-ratio-select");
      const resolutionSelect = document.querySelector("#resolution-select");
      const batchSizeSelect = document.querySelector("#batch-size-select");
      const materialSelectButton = document.querySelector("#material-select-button");
      const materialPanel = document.querySelector("#material-panel");
      const paletteSelectWrap = document.querySelector(".palette-select-wrap");
      const colorPaletteSelect = document.querySelector("#color-palette-select");
      const paletteInlineEditor = document.querySelector("#palette-inline-editor");
      const paletteSwatchRow = document.querySelector("#palette-swatch-row");
      const paletteEditorPanel = document.querySelector("#palette-editor-panel");
      const pluginPaletteColorList = document.querySelector("#plugin-palette-color-list");
      const pluginAddPaletteColorButton = document.querySelector("#plugin-add-palette-color-button");
      const shapeArchitectureSelect = document.querySelector("#shape-architecture-select");
      const selectionBar = document.querySelector("#selection-bar");
      const addSelectionButton = document.querySelector("#add-selection-button");
      const selectionStatus = document.querySelector("#selection-status");
      const attachmentRow = document.querySelector("#attachment-row");
      const chat = document.querySelector("#chat");
      const messageInput = document.querySelector("#message-input");
      const sendButton = document.querySelector("#send-button");
      const resizeHandle = document.querySelector("#resize-handle");
      const collapseButton = document.querySelector("#collapse-button");
      const scenarioPanel = document.querySelector("#scenario-panel");
      const memberLoginOverlay = document.querySelector("#member-login-overlay");
      const memberLoginForm = document.querySelector("#member-login-form");
      const memberInviteCodeInput = document.querySelector("#member-invite-code");
      const memberLoginButton = document.querySelector("#member-login-button");
      const memberLoginStatus = document.querySelector("#member-login-status");
      const memberSessionSummary = document.querySelector("#member-session-summary");
      const memberSessionLabel = document.querySelector("#member-session-label");
      const memberLogoutButton = document.querySelector("#member-logout-button");
      const scenarioAgentDraftStorageKey = "brand-style-scenario-agent-draft";
      const memberSessionStorageKey = "brand-style-member-session";
      let selectedAssets = [];
      let batchSize = 1;
      let aspectRatio = "auto";
      let resolution = "2k";
      let materials = [];
      let materialPresetIds = [];
      let colorPalettes = [];
      let operationScenarios = [];
      let scenarioAgents = [];
      let activeScenarioSuggestions = [];
      let selectedOperationScenarioId = "";
      let colorPaletteId = "";
      let customPaletteColors = [];
      let shapeArchitectureId = "";
      let scenarioAgentDraft = null;
      let isSending = false;
      let isLoadingConfig = false;
      let activeConversationId = null;
      let activeGenerationController = null;
      let isCollapsed = false;
      let materialPanelCloseTimer = null;
      let palettePanelCloseTimer = null;
      let palettePanelDeletePointer = null;
      let memberSessionToken = localStorage.getItem(memberSessionStorageKey) || "";
      let memberSession = null;
      const fixedWindowHeight = 780;
      const fixedWindowWidth = 300;
      let expandedWindowSize = {
        width: fixedWindowWidth,
        height: fixedWindowHeight,
      };
      const pendingInsertButtons = new Map();
      const defaultScenarioAgents = [
        {
          id: "miniature-world",
          name: "微缩世界",
          trigger: "/微缩世界",
          description: "适合微缩模型世界、运营活动主视觉、3:4 KV。",
        },
        {
          id: "single-stage",
          name: "单体舞台",
          trigger: "/单体舞台",
          description: "适合圆形舞台单体场景、系列化活动视觉、4:3 KV。",
        },
      ];
      scenarioAgents = [...defaultScenarioAgents];

