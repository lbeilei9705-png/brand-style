figma.showUI(__html__, {
  width: 320,
  height: 780,
  themeColors: true,
});

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function imageUrlToBytes(imageUrl) {
  if (imageUrl.startsWith("data:")) {
    return dataUrlToBytes(imageUrl);
  }

  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`下载生成图片失败：${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function readUint32(bytes, offset) {
  return ((bytes[offset] || 0) << 24)
    + ((bytes[offset + 1] || 0) << 16)
    + ((bytes[offset + 2] || 0) << 8)
    + (bytes[offset + 3] || 0);
}

function readUint32Le(bytes, offset) {
  return (bytes[offset] || 0)
    + ((bytes[offset + 1] || 0) << 8)
    + ((bytes[offset + 2] || 0) << 16)
    + ((bytes[offset + 3] || 0) << 24);
}

function readUint16Le(bytes, offset) {
  return (bytes[offset] || 0) + ((bytes[offset + 1] || 0) << 8);
}

function readUint24Le(bytes, offset) {
  return (bytes[offset] || 0) + ((bytes[offset + 1] || 0) << 8) + ((bytes[offset + 2] || 0) << 16);
}

function getPngSize(bytes) {
  const isPng = bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4E
    && bytes[3] === 0x47;

  if (!isPng || bytes.length < 24) {
    return undefined;
  }

  return {
    width: readUint32(bytes, 16),
    height: readUint32(bytes, 20),
  };
}

function getJpegSize(bytes) {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
    return undefined;
  }

  let offset = 2;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xFF) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    const length = ((bytes[offset + 2] || 0) << 8) + (bytes[offset + 3] || 0);
    const isStartOfFrame = marker >= 0xC0 && marker <= 0xC3;

    if (isStartOfFrame && offset + 8 < bytes.length) {
      return {
        height: ((bytes[offset + 5] || 0) << 8) + (bytes[offset + 6] || 0),
        width: ((bytes[offset + 7] || 0) << 8) + (bytes[offset + 8] || 0),
      };
    }

    offset += 2 + length;
  }

  return undefined;
}

function getWebpSize(bytes) {
  const isWebp = bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50;

  if (!isWebp || bytes.length < 30) {
    return undefined;
  }

  let offset = 12;

  while (offset + 8 < bytes.length) {
    const chunk = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = readUint32Le(bytes, offset + 4);
    const dataOffset = offset + 8;

    if (chunk === "VP8X" && dataOffset + 10 <= bytes.length) {
      return {
        width: readUint24Le(bytes, dataOffset + 4) + 1,
        height: readUint24Le(bytes, dataOffset + 7) + 1,
      };
    }

    if (chunk === "VP8L" && dataOffset + 5 <= bytes.length && bytes[dataOffset] === 0x2F) {
      const b1 = bytes[dataOffset + 1] || 0;
      const b2 = bytes[dataOffset + 2] || 0;
      const b3 = bytes[dataOffset + 3] || 0;
      const b4 = bytes[dataOffset + 4] || 0;

      return {
        width: 1 + (((b2 & 0x3F) << 8) | b1),
        height: 1 + (((b4 & 0x0F) << 10) | (b3 << 2) | ((b2 & 0xC0) >> 6)),
      };
    }

    if (chunk === "VP8 " && dataOffset + 10 <= bytes.length) {
      return {
        width: readUint16Le(bytes, dataOffset + 6) & 0x3FFF,
        height: readUint16Le(bytes, dataOffset + 8) & 0x3FFF,
      };
    }

    offset += 8 + size + (size % 2);
  }

  return undefined;
}

function getImageSize(bytes, fallbackWidth, fallbackHeight) {
  const parsed = getPngSize(bytes) || getJpegSize(bytes) || getWebpSize(bytes);

  if (parsed) {
    return parsed;
  }

  return {
    width: Math.max(1, Math.round(Number(fallbackWidth) || 1024)),
    height: Math.max(1, Math.round(Number(fallbackHeight) || 1024)),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function exportSelection() {
  const nodes = figma.currentPage.selection.filter((node) => "exportAsync" in node);

  if (!nodes.length) {
    figma.ui.postMessage({
      type: "selection-synced",
      payload: {
        count: 0,
        assets: [],
        message: "请在 Figma 画布中选择一个或多个可导出的图层。",
      },
    });
    return;
  }

  const assets = await Promise.all(nodes.map(async (node, index) => {
    const bytes = await node.exportAsync({
      format: "PNG",
      constraint: {
        type: "SCALE",
        value: 2,
      },
    });

    return {
      id: node.id,
      name: node.name || `selection-${index + 1}`,
      filename: `${node.name || `figma-selection-${index + 1}`}.png`,
      mimeType: "image/png",
      sizeBytes: bytes.length,
      width: "width" in node ? Math.max(1, Math.round(Number(node.width))) : undefined,
      height: "height" in node ? Math.max(1, Math.round(Number(node.height))) : undefined,
      assetDataUrl: `data:image/png;base64,${bytesToBase64(bytes)}`,
    };
  }));

  figma.ui.postMessage({
    type: "selection-synced",
    payload: {
      count: assets.length,
      assets,
      message: assets.length === 1
        ? `${assets[0].filename} · ${Math.round(assets[0].sizeBytes / 1024)} KB`
        : `已选择 ${assets.length} 个对象`,
    },
  });
}

async function insertResult(imageUrl, width, height) {
  figma.notify("正在插入生成图片...");
  const bytes = await imageUrlToBytes(imageUrl);
  const imageSize = getImageSize(bytes, width, height);
  const image = figma.createImage(bytes);
  const rect = figma.createRectangle();

  rect.name = "Generated 3D Icon Result";
  rect.resize(imageSize.width, imageSize.height);
  rect.fills = [
    {
      type: "IMAGE",
      scaleMode: "FIT",
      imageHash: image.hash,
    },
  ];

  const selection = figma.currentPage.selection[0];

  if (selection) {
    rect.x = selection.x + selection.width + 32;
    rect.y = selection.y;
  } else {
    rect.x = figma.viewport.center.x - imageSize.width / 2;
    rect.y = figma.viewport.center.y - imageSize.height / 2;
  }

  figma.currentPage.appendChild(rect);
  figma.currentPage.selection = [rect];
  figma.viewport.scrollAndZoomIntoView([rect]);
  figma.notify(`已按原始尺寸插入生成图片：${imageSize.width} × ${imageSize.height}`);
}

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

