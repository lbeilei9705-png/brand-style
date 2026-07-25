      function getReadableError(error) {
        const issueId = ensureIssueId(error);
        if (error && typeof error === "object" && !error.diagnosticRecorded) {
          error.diagnosticRecorded = true;
          recordClientError(error);
        }
        const suffix = `（问题编号：${issueId}${error?.requestId ? `，请求编号：${error.requestId}` : ""}）`;
        if (error instanceof TypeError && error.message === "Failed to fetch") {
          return `无法连接 Brand Style 后端服务，请确认服务可访问，并重新打开插件后重试。${suffix}`;
        }

        return `${error?.message || "发生未知错误，请稍后重试。"}${suffix}`;
      }

      function getGreatestCommonDivisor(left, right) {
        let a = Math.abs(left);
        let b = Math.abs(right);

        while (b) {
          const remainder = a % b;
          a = b;
          b = remainder;
        }

        return a || 1;
      }

      function resolveAspectRatio() {
        if (aspectRatio !== "auto") {
          return aspectRatio;
        }

        const primaryAsset = selectedAssets.find((asset) => Number(asset.width) > 0 && Number(asset.height) > 0);
        const width = Math.round(Number(primaryAsset?.width));
        const height = Math.round(Number(primaryAsset?.height));

        if (!width || !height) {
          return "1:1";
        }

        const divisor = getGreatestCommonDivisor(width, height);
        return `${width / divisor}:${height / divisor}`;
      }

      function updateAspectRatioAutoLabel() {
        const autoOption = aspectRatioSelect.querySelector('option[value="auto"]');
        if (!autoOption) {
          return;
        }

        const primaryAsset = selectedAssets.find((asset) => Number(asset.width) > 0 && Number(asset.height) > 0);
        if (!primaryAsset) {
          autoOption.textContent = "自动";
          return;
        }

        const width = Math.round(Number(primaryAsset.width));
        const height = Math.round(Number(primaryAsset.height));
        const divisor = getGreatestCommonDivisor(width, height);
        autoOption.textContent = `自动（${width / divisor}:${height / divisor}）`;
      }

      function getLabeledSelectedAssets() {
        return selectedAssets.map((asset, index) => ({
          ...asset,
          referenceLabel: `图${index + 1}`,
        }));
      }

      function hasLineSketchKeyword(value) {
        return /(线稿|草图|描边|轮廓稿|手绘线|sketch|line|outline|wireframe)/i.test(value || "");
      }

      function loadImage(src) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("图片识别失败"));
          image.src = src;
        });
      }

      async function looksLikeLineSketch(asset) {
        if (!asset?.assetDataUrl || !asset.assetDataUrl.startsWith("data:image/")) {
          return false;
        }

        const image = await loadImage(asset.assetDataUrl);
        const maxSide = 96;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
        const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
        const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });

        if (!context) {
          return false;
        }

        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let opaquePixels = 0;
        let whitePixels = 0;
        let inkPixels = 0;
        let saturatedPixels = 0;

        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3];

          if (alpha < 24) {
            continue;
          }

          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          const max = Math.max(red, green, blue);
          const min = Math.min(red, green, blue);
          const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          const saturation = max ? (max - min) / max : 0;
          opaquePixels += 1;

          if (luma > 244 && saturation < 0.1) {
            whitePixels += 1;
            continue;
          }

          if (luma < 210) {
            inkPixels += 1;
          }

          if (saturation > 0.24 && luma < 245) {
            saturatedPixels += 1;
          }
        }

        if (!opaquePixels) {
          return false;
        }

        const whiteRatio = whitePixels / opaquePixels;
        const inkRatio = inkPixels / opaquePixels;
        const saturatedRatio = saturatedPixels / opaquePixels;

        return whiteRatio > 0.68 && inkRatio > 0.008 && inkRatio < 0.24 && saturatedRatio < 0.14;
      }

      async function inferInputType(assets, content) {
        if (hasLineSketchKeyword(content)) {
          return "line_sketch";
        }

        const primaryAsset = assets[0];

        if (!primaryAsset) {
          return "auto";
        }

        if (hasLineSketchKeyword(`${primaryAsset.name || ""} ${primaryAsset.filename || ""}`)) {
          return "line_sketch";
        }

        try {
          return await looksLikeLineSketch(primaryAsset) ? "line_sketch" : "auto";
        } catch {
          return "auto";
        }
      }

      function getAssetIdentity(asset) {
        return String(asset.id || `${asset.filename}-${asset.sizeBytes}`).replace(/-\d+$/, "");
      }

      function mergeSelectedAssets(incomingAssets) {
        const merged = [...selectedAssets];

        for (const asset of incomingAssets) {
          const identity = getAssetIdentity(asset);
          const existingIndex = merged.findIndex((item) => getAssetIdentity(item) === identity);

          if (existingIndex >= 0) {
            merged[existingIndex] = {
              ...merged[existingIndex],
              ...asset,
            };
            continue;
          }

          merged.push(asset);
        }

        return merged;
      }

      function renderAttachments() {
        attachmentRow.innerHTML = "";

        for (const [index, asset] of selectedAssets.entries()) {
          const thumb = document.createElement("section");
          const image = document.createElement("img");
          const label = document.createElement("span");
          const removeButton = document.createElement("button");

          thumb.className = "thumb";
          thumb.title = `图${index + 1}：${asset.name || asset.filename}`;
          image.src = asset.assetDataUrl;
          image.alt = `图${index + 1}：${asset.name || asset.filename}`;
          label.className = "thumb-label";
          label.textContent = `图${index + 1}`;
          removeButton.type = "button";
          removeButton.setAttribute("aria-label", "删除图片");
          removeButton.textContent = "×";
          removeButton.addEventListener("click", () => {
            selectedAssets = selectedAssets.filter((item) => getAssetIdentity(item) !== getAssetIdentity(asset));
            updateAspectRatioAutoLabel();
            renderAttachments();
            selectionBar.textContent = selectedAssets.length
              ? `已添加 ${selectedAssets.length} 张参考图`
              : "当前没有参考图。点击画布对象会自动添加缩略图。";
            updateRunState();
          });
          thumb.append(image, label, removeButton);
          attachmentRow.appendChild(thumb);
        }

        updateRunState();
      }

      function updateRunState() {
        if (!memberSession) {
          sendButton.disabled = true;
          sendButton.textContent = "请登录";
          sendButton.title = "请输入成员邀请码后使用。";
          return;
        }

        if (isSending) {
          sendButton.disabled = false;
          sendButton.textContent = "暂停";
          sendButton.title = "暂停本次生成";
          return;
        }

        const hasText = Boolean(messageInput.value.trim());
        const isScenarioAgentPrompt = Boolean(getScenarioAgentFromContent(messageInput.value));
        const hasConfig = Boolean(
          agentSelect.value
          || colorPaletteId
          || shapeArchitectureId
          || materialPresetIds.length
          || selectedOperationScenarioId
        );
        const hasOnlyImageWithoutDirection = selectedAssets.length > 0 && !hasText && !hasConfig;
        const canRun = hasText || (selectedAssets.length > 0 && !hasOnlyImageWithoutDirection);
        const directionHint = "请描述要怎么处理这张图，或选择一个风格/形状/配色/材质。";
        sendButton.disabled = !canRun;
        sendButton.textContent = canRun ? isScenarioAgentPrompt ? "生成Prompt" : "整活" : "没活";
        sendButton.title = hasOnlyImageWithoutDirection
          ? directionHint
          : canRun
            ? isScenarioAgentPrompt ? "让场景智能体补全 Prompt" : "开始生成"
            : "请输入需求，或添加参考图并选择生成方向。";

        if (hasOnlyImageWithoutDirection) {
          selectionStatus.textContent = directionHint;
        } else if (selectionStatus.textContent === directionHint) {
          selectionStatus.textContent = selectedAssets.length
            ? `已添加 ${selectedAssets.length} 张参考图。`
            : "打开插件不会自动读取选区。";
        }
      }

      function resizeMessageInput() {
        messageInput.style.height = "128px";
        const maxHeight = Number.parseFloat(getComputedStyle(messageInput).maxHeight) || 210;
        const nextHeight = Math.min(messageInput.scrollHeight, maxHeight);
        messageInput.style.height = `${Math.max(128, nextHeight)}px`;
        messageInput.style.overflowY = messageInput.scrollHeight > maxHeight ? "auto" : "hidden";
      }

      function postResize(width, height) {
        parent.postMessage({
          pluginMessage: {
            type: "resize-ui",
            width,
            height,
          },
        }, "*");
      }

      function scrollComposerActionsIntoView() {
        requestAnimationFrame(() => {
          const app = document.querySelector(".app");
          if (!app || !sendButton) {
            return;
          }

          const appRect = app.getBoundingClientRect();
          const buttonRect = sendButton.getBoundingClientRect();
          const bottomPadding = 28;
          const overflow = buttonRect.bottom + bottomPadding - appRect.bottom;

          if (overflow > 0) {
            app.scrollTop += overflow;
          }
        });
      }

