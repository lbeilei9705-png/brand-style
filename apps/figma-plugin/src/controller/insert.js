async function insertResult(imageUrl, width, height, position, shouldScroll = true) {
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

  if (position) {
    rect.x = position.x;
    rect.y = position.y;
  } else if (selection) {
    rect.x = selection.x + selection.width + 32;
    rect.y = selection.y;
  } else {
    rect.x = figma.viewport.center.x - imageSize.width / 2;
    rect.y = figma.viewport.center.y - imageSize.height / 2;
  }

  figma.currentPage.appendChild(rect);
  figma.currentPage.selection = [rect];
  if (shouldScroll) {
    figma.viewport.scrollAndZoomIntoView([rect]);
  }
  figma.notify(`已按原始尺寸插入生成图片：${imageSize.width} × ${imageSize.height}`);
}

figma.on("drop", (event) => {
  const metadata = event.dropMetadata;

  if (metadata?.type !== "generated-result" || !metadata.imageUrl) {
    return true;
  }

  insertResult(
    metadata.imageUrl,
    metadata.width,
    metadata.height,
    { x: event.absoluteX, y: event.absoluteY },
    false,
  ).catch((error) => {
    const errorMessage = error instanceof Error ? error.message : "拖拽插入 Figma 失败。";
    figma.notify(errorMessage, { error: true });
  });

  return false;
});

