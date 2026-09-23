export function fileToAsset(file, index) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const finish = (assetDataUrl, mimeType, sizeBytes, width, height) => resolve({
          id: `web_asset_${crypto.randomUUID()}`,
          referenceLabel: `图${index + 1}`,
          name: file.name,
          filename: file.name,
          mimeType,
          sizeBytes,
          assetDataUrl,
          width,
          height,
        });
        if (scale === 1 && file.size <= 2 * 1024 * 1024) {
          finish(String(reader.result), file.type, file.size, image.naturalWidth, image.naturalHeight);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        const encode = (type, quality) => canvas.toBlob((blob) => {
          if (type === "image/webp" && blob?.type !== "image/webp") {
            encode("image/jpeg", .88);
            return;
          }
          if (!blob) return reject(new Error(`${file.name} 压缩失败`));
          const compressedReader = new FileReader();
          compressedReader.onerror = () => reject(new Error(`${file.name} 压缩失败`));
          compressedReader.onload = () => finish(
            String(compressedReader.result),
            blob.type,
            blob.size,
            canvas.width,
            canvas.height,
          );
          compressedReader.readAsDataURL(blob);
        }, type, quality);
        encode("image/webp", .88);
      };
      image.onerror = () => reject(new Error(`${file.name} 不是有效图片`));
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function imageUrlToAsset(result, index) {
  const response = await fetch(result.imageUrl);
  if (!response.ok) throw new Error("读取生成图片失败");
  const blob = await response.blob();
  if (blob.size > 10 * 1024 * 1024) throw new Error("生成图片超过 10MB，无法作为参考图");
  const file = new File([blob], `generated-${result.rank}.png`, {
    type: blob.type || "image/png",
  });
  return fileToAsset(file, index);
}

export async function downloadResult(task, result) {
  const link = document.createElement("a");
  try {
    const response = await fetch(result.imageUrl);
    if (!response.ok) throw new Error();
    const blob = await response.blob();
    const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `brand-style-${task.id}-${result.rank}.${extension}`;
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    link.href = result.imageUrl;
    link.target = "_blank";
    link.rel = "noopener";
  }
  link.click();
}
