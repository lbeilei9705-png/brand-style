figma.ui.onmessage = async (message) => {
  if (message.type === "resize-ui") {
    figma.ui.resize(
      clamp(Number(message.width) || 560, 72, 1200),
      clamp(Number(message.height) || 780, 72, 1100),
    );
    return;
  }

  if (message.type === "sync-selection") {
    await exportSelection();
    return;
  }

  if (message.type === "insert-result") {
    try {
      await insertResult(message.imageUrl, message.width, message.height);
      figma.ui.postMessage({
        type: "insert-result-finished",
        requestId: message.requestId,
        ok: true,
        message: "已插入 Figma",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "插入 Figma 失败。";
      figma.notify(errorMessage, { error: true });
      figma.ui.postMessage({
        type: "insert-result-finished",
        requestId: message.requestId,
        ok: false,
        message: errorMessage,
      });
    }
  }
};

