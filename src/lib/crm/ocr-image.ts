/**
 * Pré-processamento de imagem no navegador para aumentar a precisão do OCR local.
 * Amplia a imagem, converte para escala de cinza e aumenta o contraste.
 */

const TARGET_MIN_WIDTH = 1600;
const MAX_WIDTH = 2600;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    image.src = src;
  });
}

/**
 * Retorna uma variante da imagem otimizada para OCR. Em caso de falha,
 * devolve a imagem original para não bloquear a leitura.
 */
export async function preprocessForOcr(dataUrl: string): Promise<string> {
  try {
    const image = await loadImage(dataUrl);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) return dataUrl;

    const scale = Math.min(MAX_WIDTH / naturalWidth, Math.max(1, TARGET_MIN_WIDTH / naturalWidth));
    const width = Math.round(naturalWidth * Math.max(scale, 1));
    const height = Math.round(naturalHeight * Math.max(scale, 1));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return dataUrl;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);

    const frame = ctx.getImageData(0, 0, width, height);
    const pixels = frame.data;

    // 1ª passada: escala de cinza + média de luminância.
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = Math.round(0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!);
      pixels[i] = gray;
      pixels[i + 1] = gray;
      pixels[i + 2] = gray;
      sum += gray;
    }
    const mean = sum / (pixels.length / 4);

    // 2ª passada: contraste adaptativo suave em torno da média (mantém antialias
    // das fontes, que o Tesseract lê melhor do que um binário duro).
    const contrast = 1.7;
    for (let i = 0; i < pixels.length; i += 4) {
      const value = pixels[i]!;
      const boosted = Math.max(0, Math.min(255, (value - mean) * contrast + mean));
      pixels[i] = boosted;
      pixels[i + 1] = boosted;
      pixels[i + 2] = boosted;
    }

    // Prints de tema escuro: inverte para texto escuro em fundo claro.
    if (mean < 110) {
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 255 - pixels[i]!;
        pixels[i + 1] = 255 - pixels[i + 1]!;
        pixels[i + 2] = 255 - pixels[i + 2]!;
      }
    }

    ctx.putImageData(frame, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}
