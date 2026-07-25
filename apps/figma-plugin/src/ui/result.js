      function getImageExtension(imageUrl) {
        const dataUrlMatch = imageUrl.match(/^data:image\/([^;]+)/);

        if (dataUrlMatch) {
          return dataUrlMatch[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
        }

        try {
          const extension = new URL(imageUrl).pathname.split(".").pop();

          if (extension && extension.length <= 5) {
            return extension.toLowerCase();
          }
        } catch {
          // Ignore malformed URLs and fall back to PNG.
        }

        return "png";
      }

      function downloadBlobUrl(blobUrl, filename) {
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      async function downloadOriginalImage(result) {
        const extension = getImageExtension(result.imageUrl);
        const sizePart = result.width && result.height ? `-${result.width}x${result.height}` : "";
        const filename = `brand-style-${resolution}-image-${result.rank}${sizePart}.${extension}`;

        if (result.imageUrl.startsWith("data:")) {
          downloadBlobUrl(result.imageUrl, filename);
          trackEvent("result_download_success", { rank: result.rank, source: "data_url" });
          return;
        }

        try {
          const response = await fetch(result.imageUrl);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          downloadBlobUrl(blobUrl, filename);
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
          trackEvent("result_download_success", { rank: result.rank, source: "remote" });
        } catch (error) {
          trackEvent("result_download_fail", {
            rank: result.rank,
            issueId: ensureIssueId(error),
            fallbackOpened: true,
          });
          window.open(result.imageUrl, "_blank");
        }
      }

      function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("读取图片失败。"));
          reader.readAsDataURL(blob);
        });
      }

      function loadImageElement(src) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("图片加载失败，无法插入 Figma。"));
          image.src = src;
        });
      }

      async function normalizeImageForFigma(dataUrl) {
        const figmaSupportedDataUrl = /^data:image\/(?:png|jpe?g|gif);base64,/i.test(dataUrl);
        const image = await loadImageElement(dataUrl);
        const width = Math.max(1, image.naturalWidth || image.width || 1);
        const height = Math.max(1, image.naturalHeight || image.height || 1);
        const maxFigmaSide = 4096;
        const scale = Math.min(1, maxFigmaSide / Math.max(width, height));
        const needsCanvas = !figmaSupportedDataUrl || scale < 1;

        if (!needsCanvas) {
          return { imageUrl: dataUrl, width, height };
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("无法转换图片格式。");
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        return {
          imageUrl: canvas.toDataURL("image/png"),
          width: canvas.width,
          height: canvas.height,
        };
      }

      async function prepareImageForFigma(result) {
        let dataUrl = result.imageUrl;

        if (!dataUrl.startsWith("data:")) {
          const response = await fetch(dataUrl);

          if (!response.ok) {
            throw new Error(`下载生成图片失败：HTTP ${response.status}`);
          }

          dataUrl = await blobToDataUrl(await response.blob());
        }

        return normalizeImageForFigma(dataUrl);
      }

      async function insertGeneratedResult(button, result) {
        const originalText = button.textContent;
        const requestId = `insert_${Date.now()}_${Math.random().toString(16).slice(2)}`;

        button.disabled = true;
        button.textContent = "插入中...";
        trackEvent("result_insert_start", { rank: result.rank, requestId });

        try {
          const prepared = await prepareImageForFigma(result);
          pendingInsertButtons.set(requestId, { button, originalText });
          parent.postMessage({
            pluginMessage: {
              type: "insert-result",
              requestId,
              imageUrl: prepared.imageUrl,
              width: prepared.width || result.width,
              height: prepared.height || result.height,
            },
          }, "*");
        } catch (error) {
          button.disabled = false;
          button.textContent = originalText;
          addMessage("system", getReadableError(error));
          trackEvent("result_insert_fail", {
            rank: result.rank,
            requestId,
            issueId: ensureIssueId(error),
          });
        }
      }

      function setupResultDrag(image, result) {
        image.draggable = true;
        image.title = "拖拽到 Figma 画布插入";
        image.addEventListener("dragstart", (event) => {
          if (!event.dataTransfer) {
            return;
          }

          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("text/plain", `generated-result-${result.rank}`);
          trackEvent("result_drag_start", { rank: result.rank });
        });
        image.addEventListener("dragend", async (event) => {
          const endedInsidePlugin = event.clientX >= 0
            && event.clientX <= window.innerWidth
            && event.clientY >= 0
            && event.clientY <= window.innerHeight;

          if (endedInsidePlugin) {
            return;
          }

          try {
            trackEvent("result_drop_start", { rank: result.rank });
            const prepared = await prepareImageForFigma(result);
            parent.postMessage({
              pluginDrop: {
                clientX: event.clientX,
                clientY: event.clientY,
                items: [
                  {
                    type: "text/plain",
                    data: `generated-result-${result.rank}`,
                  },
                ],
                dropMetadata: {
                  type: "generated-result",
                  imageUrl: prepared.imageUrl,
                  width: prepared.width || result.width,
                  height: prepared.height || result.height,
                },
              },
            }, "*");
          } catch (error) {
            addMessage("system", getReadableError(error));
            trackEvent("result_drop_fail", {
              rank: result.rank,
              issueId: ensureIssueId(error),
            });
          }
        });
      }

      function addMessage(role, content, attachments = []) {
        const node = document.createElement("article");
        const contentNode = document.createElement("div");

        node.className = `message ${role}`;

        if (attachments.length) {
          const attachmentNode = document.createElement("div");
          attachmentNode.className = "message-attachments";

          for (const [index, asset] of attachments.entries()) {
            const item = document.createElement("section");
            const image = document.createElement("img");
            const label = document.createElement("span");

            item.className = "message-attachment";
            image.src = asset.assetDataUrl;
            image.alt = `${asset.referenceLabel || `图${index + 1}`}：${asset.name || asset.filename || "参考图"}`;
            label.className = "message-attachment-label";
            label.textContent = asset.referenceLabel || `图${index + 1}`;
            item.append(image, label);
            attachmentNode.appendChild(item);
          }

          node.appendChild(attachmentNode);
        }

        contentNode.className = "message-content";
        contentNode.textContent = content;
        node.appendChild(contentNode);

        const issueMatch = role === "system" ? content.match(/问题编号：([^，）]+)/) : null;
        if (issueMatch) {
          const actions = document.createElement("div");
          const copyButton = document.createElement("button");
          const exportButton = document.createElement("button");
          actions.className = "diagnostic-actions";
          copyButton.type = exportButton.type = "button";
          copyButton.textContent = "复制诊断信息";
          exportButton.textContent = "导出诊断包";
          copyButton.addEventListener("click", () => copyDiagnosticInfo(issueMatch[1]));
          exportButton.addEventListener("click", () => downloadDiagnosticBundle(false));
          actions.append(copyButton, exportButton);
          node.appendChild(actions);
        }

        if (role === "user" && content) {
          const reuseButton = document.createElement("button");
          reuseButton.className = "reuse-message-button";
          reuseButton.type = "button";
          reuseButton.title = "复制到输入框";
          reuseButton.setAttribute("aria-label", "复制到输入框");
          reuseButton.addEventListener("click", () => {
            messageInput.value = content;
            selectedOperationScenarioId = "";
            messageInput.focus();
            resizeMessageInput();
            updateRunState();
            renderScenarioSuggestions();
          });
          node.appendChild(reuseButton);
        }

        chat.appendChild(node);
        chat.scrollTop = chat.scrollHeight;
        return node;
      }

