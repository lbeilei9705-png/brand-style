const maxReferenceExportSize = 1024;

function getExportSize(node) {
  const width = "width" in node ? Math.max(1, Math.round(Number(node.width))) : undefined;
  const height = "height" in node ? Math.max(1, Math.round(Number(node.height))) : undefined;

  if (!width || !height) {
    return {
      constraint: {
        type: "SCALE",
        value: 1,
      },
    };
  }

  const maxDimension = Math.max(width, height);

  if (maxDimension <= maxReferenceExportSize) {
    return {
      width,
      height,
      constraint: {
        type: "SCALE",
        value: 1,
      },
    };
  }

  const scale = maxReferenceExportSize / maxDimension;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    constraint: width >= height
      ? {
        type: "WIDTH",
        value: maxReferenceExportSize,
      }
      : {
        type: "HEIGHT",
        value: maxReferenceExportSize,
      },
  };
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
    const exportSize = getExportSize(node);
    const bytes = await node.exportAsync({
      format: "PNG",
      constraint: exportSize.constraint,
    });

    return {
      id: node.id,
      name: node.name || `selection-${index + 1}`,
      filename: `${node.name || `figma-selection-${index + 1}`}.png`,
      mimeType: "image/png",
      sizeBytes: bytes.length,
      width: exportSize.width,
      height: exportSize.height,
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

