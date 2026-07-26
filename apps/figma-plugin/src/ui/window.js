
      function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
      }

      function setupResizeHandle() {
        let isResizing = false;
        let startX = 0;
        let startY = 0;
        let startWidth = 0;
        let startHeight = 0;

        function handleMove(event) {
          if (!isResizing) {
            return;
          }

          const width = clamp(startWidth + event.clientX - startX, fixedWindowWidth, 1200);
          const height = clamp(startHeight + event.clientY - startY, 520, 1100);
          expandedWindowSize = { width, height };
          postResize(width, height);
        }

        function stopResize() {
          isResizing = false;
          document.body.classList.remove("resizing");
          document.removeEventListener("mousemove", handleMove);
          document.removeEventListener("mouseup", stopResize);
        }

        resizeHandle.addEventListener("mousedown", (event) => {
          event.preventDefault();
          isResizing = true;
          document.body.classList.add("resizing");
          startX = event.clientX;
          startY = event.clientY;
          startWidth = window.innerWidth;
          startHeight = window.innerHeight;
          document.addEventListener("mousemove", handleMove);
          document.addEventListener("mouseup", stopResize);
        });

        resizeHandle.addEventListener("dblclick", () => {
          const shouldExpand = window.innerWidth < 680;
          expandedWindowSize = {
            width: shouldExpand ? 760 : fixedWindowWidth,
            height: shouldExpand ? 860 : fixedWindowHeight,
          };
          postResize(expandedWindowSize.width, expandedWindowSize.height);
        });
      }

      collapseButton.addEventListener("click", () => {
        if (isCollapsed) {
          isCollapsed = false;
          document.body.classList.remove("is-collapsed");
          collapseButton.title = "收起插件";
          collapseButton.setAttribute("aria-label", "收起插件");
          postResize(expandedWindowSize.width, expandedWindowSize.height);
          return;
        }

        expandedWindowSize = {
          width: clamp(window.innerWidth || fixedWindowWidth, fixedWindowWidth, 1200),
          height: clamp(window.innerHeight || fixedWindowHeight, 520, 1100),
        };
        isCollapsed = true;
        document.body.classList.add("is-collapsed");
        collapseButton.title = "展开插件";
        collapseButton.setAttribute("aria-label", "展开插件");
        postResize(72, 72);
      });
