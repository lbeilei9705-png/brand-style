      function renderResults(task, anchor) {
        const shouldFollowLatest = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 48;
        const wrapper = document.createElement("article");
        wrapper.className = "message assistant";
        const title = document.createElement("strong");
        title.textContent = `生成完成：${task.results.length} 张图片`;
        const grid = document.createElement("div");
        grid.className = "results";

        for (const result of task.results) {
          const card = document.createElement("section");
          card.className = "result-card";
          const sizeLabel = result.width && result.height ? `${result.width} × ${result.height}` : "按原始尺寸";
          card.innerHTML = `
            <img src="${result.imageUrl}" alt="候选 ${result.rank}" draggable="true" title="拖拽到 Figma 画布插入" />
            <div>
              <strong>图片 ${result.rank}</strong>
              <span>${sizeLabel} · 可拖拽到画布</span>
              <section class="result-actions">
                <button class="insert-result-button" type="button">插入 Figma</button>
                <button class="download-result-button" type="button">下载原图</button>
              </section>
            </div>
          `;
          setupResultDrag(card.querySelector("img"), result);
          card.querySelector(".insert-result-button").addEventListener("click", async (event) => {
            await insertGeneratedResult(event.currentTarget, result);
          });
          card.querySelector(".download-result-button").addEventListener("click", async () => {
            await downloadOriginalImage(result);
          });
          grid.appendChild(card);
        }

        wrapper.append(title, grid, createPromptDebugPanel(task));
        if (anchor?.parentNode === chat) {
          anchor.after(wrapper);
        } else {
          chat.appendChild(wrapper);
        }
        if (shouldFollowLatest) {
          chat.scrollTop = chat.scrollHeight;
        }
      }

