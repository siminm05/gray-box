let originalPixels = null;
let originalWidth = 0;
let originalHeight = 0;
let processed = null;

const $ = id => document.getElementById(id);
const originalCanvas = $("original");
const processedCanvas = $("processed");

function show(canvas, pixels, width, height) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);

  for (let i = 0, j = 0; i < pixels.length; i++, j += 4) {
    image.data[j] = pixels[i];
    image.data[j + 1] = pixels[i];
    image.data[j + 2] = pixels[i];
    image.data[j + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

async function readPGM(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let position = 0;

  function skipWhitespaceAndComments() {
    while (position < bytes.length) {
      if (bytes[position] === 35) {
        while (position < bytes.length && bytes[position] !== 10) position++;
      } else if ([9, 10, 13, 32].includes(bytes[position])) {
        position++;
      } else {
        break;
      }
    }
  }

  function token() {
    skipWhitespaceAndComments();
    let value = "";
    while (position < bytes.length && ![9, 10, 13, 32, 35].includes(bytes[position])) {
      value += String.fromCharCode(bytes[position++]);
    }
    return value;
  }

  const magic = token();
  const width = Number(token());
  const height = Number(token());
  const maximum = Number(token());

  if (magic !== "P2" && magic !== "P5") throw Error("PGM must be P2 or P5.");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 64000000 || !Number.isInteger(maximum) || maximum < 1 || maximum > 65535) {
    throw Error("Invalid PGM image.");
  }

  const pixels = new Uint8Array(width * height);
  if (magic === "P2") {
    for (let i = 0; i < pixels.length; i++) {
      const value = Number(token());
      if (!Number.isFinite(value) || value < 0 || value > maximum) throw Error("Invalid PGM pixel data.");
      pixels[i] = Math.round(value * 255 / maximum);
    }
  } else {
    // The P5 header ends with one whitespace separator. Do not skip arbitrary
    // whitespace here: the first binary pixel is allowed to have value 10 or 32.
    if (bytes[position] === 13 && bytes[position + 1] === 10) position += 2;
    else if ([10, 13, 32, 9].includes(bytes[position])) position++;

    const bytesPerPixel = maximum > 255 ? 2 : 1;
    if (position + pixels.length * bytesPerPixel > bytes.length) throw Error("PGM pixel data is incomplete.");
    for (let i = 0; i < pixels.length; i++) {
      const value = bytesPerPixel === 2
        ? (bytes[position++] << 8) | bytes[position++]
        : bytes[position++];
      pixels[i] = Math.round(value * 255 / maximum);
    }
  }

  return { pixels, width, height };
}

async function readImage(file) {
  if (file.name.toLowerCase().endsWith(".pgm")) return readPGM(file);

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height || width * height > 64000000) throw Error("Image is too large or invalid.");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);

    const rgba = context.getImageData(0, 0, width, height).data;
    const pixels = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < pixels.length; i++, j += 4) {
      // Convert RGB to grayscale before applying the image-processing operation.
      pixels[i] = Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]);
    }
    return { pixels, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function averageFilter(input, output, width, height, size) {
  // For even kernels, use a consistent size x size window: 4x4 means 16 pixels,
  // not the 5x5 window produced by a symmetric -2..2 loop.
  const start = -Math.floor((size - 1) / 2);
  const end = start + size - 1;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      let sum = 0;
      let count = 0;
      for (let dy = start; dy <= end; dy++) {
        for (let dx = start; dx <= end; dx++) {
          const y = row + dy;
          const x = col + dx;
          if (y >= 0 && y < height && x >= 0 && x < width) {
            sum += input[y * width + x];
            count++;
          }
        }
      }
      output[row * width + col] = Math.round(sum / count);
    }
  }
}

function medianFilter(input, output, width, height) {
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const values = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = row + dy;
          const x = col + dx;
          if (y >= 0 && y < height && x >= 0 && x < width) values.push(input[y * width + x]);
        }
      }
      values.sort((a, b) => a - b);
      output[row * width + col] = values[Math.floor(values.length / 2)];
    }
  }
}

function edgeFilter(input, output, width, height, prewitt) {
  const sx = prewitt
    ? [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]]
    : [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
  const sy = prewitt
    ? [[1, 1, 1], [0, 0, 0], [-1, -1, -1]]
    : [[1, 2, 1], [0, 0, 0], [-1, -2, -1]];

  output.fill(0);
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      let gx = 0;
      let gy = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const pixel = input[(row + dy) * width + col + dx];
          gx += pixel * sx[dy + 1][dx + 1];
          gy += pixel * sy[dy + 1][dx + 1];
        }
      }
      output[row * width + col] = Math.min(255, Math.abs(gx) + Math.abs(gy));
    }
  }
}

function lbpFilter(input, output, width, height) {
  const dy = [-1, -1, -1, 0, 1, 1, 1, 0];
  const dx = [-1, 0, 1, 1, 1, 0, -1, -1];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const center = input[row * width + col];
      let code = 0;
      for (let k = 0; k < 8; k++) {
        const y = Math.max(0, Math.min(height - 1, row + dy[k]));
        const x = Math.max(0, Math.min(width - 1, col + dx[k]));
        code = (code << 1) | (input[y * width + x] >= center ? 1 : 0);
      }
      output[row * width + col] = code;
    }
  }
}

function resizeNearest(input, width, height, scalePercent) {
  const scale = scalePercent / 100;
  if (scale < 0.5 || scale > 3) throw Error("Scale must be between 50% and 300%.");
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  if (outWidth * outHeight > 64000000) throw Error("The resized image would be too large.");

  const output = new Uint8Array(outWidth * outHeight);
  for (let row = 0; row < outHeight; row++) {
    for (let col = 0; col < outWidth; col++) {
      const sourceY = Math.min(height - 1, Math.floor(row / scale));
      const sourceX = Math.min(width - 1, Math.floor(col / scale));
      output[row * outWidth + col] = input[sourceY * width + sourceX];
    }
  }
  return { pixels: output, width: outWidth, height: outHeight };
}

function processImage(input, width, height, operation, parameter) {
  if (operation === 6) return resizeNearest(input, width, height, parameter);

  const output = new Uint8Array(width * height);
  switch (operation) {
    case 0: averageFilter(input, output, width, height, 3); break;
    case 1: averageFilter(input, output, width, height, 4); break;
    case 2: medianFilter(input, output, width, height); break;
    case 3: edgeFilter(input, output, width, height, false); break;
    case 4: edgeFilter(input, output, width, height, true); break;
    case 5: lbpFilter(input, output, width, height); break;
    default: throw Error("Please choose a valid operation.");
  }
  return { pixels: output, width, height };
}

$("imageFile").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const image = await readImage(file);
    originalPixels = image.pixels;
    originalWidth = image.width;
    originalHeight = image.height;
    processed = null;
    show(originalCanvas, originalPixels, originalWidth, originalHeight);
    processedCanvas.width = 0;
    processedCanvas.height = 0;
    $("process").disabled = false;
    $("download").disabled = true;
    $("message").textContent = `Loaded ${file.name} (${originalWidth} x ${originalHeight}).`;
  } catch (error) {
    originalPixels = null;
    $("process").disabled = true;
    $("message").textContent = error.message;
  }
});

$("operation").addEventListener("change", () => {
  $("scaleLabel").hidden = $("operation").value !== "6";
});

$("process").addEventListener("click", () => {
  if (!originalPixels) return;
  try {
    const operation = Number($("operation").value);
    const scale = operation === 6 ? Number($("scale").value) : 100;
    if (operation === 6 && (!Number.isFinite(scale) || scale < 50 || scale > 300)) {
      throw Error("Scale must be between 50% and 300%.");
    }

    const result = processImage(originalPixels, originalWidth, originalHeight, operation, scale);
    processed = result.pixels;
    show(processedCanvas, processed, result.width, result.height);
    $("download").disabled = false;
    $("message").textContent = `Finished: ${result.width} x ${result.height} pixels.`;
  } catch (error) {
    $("message").textContent = error.message;
  }
});

$("download").addEventListener("click", () => {
  if (!processed) return;
  const width = processedCanvas.width;
  const height = processedCanvas.height;
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const bytes = new Uint8Array(header.length + processed.length);
  bytes.set(header);
  bytes.set(processed, header.length);
  const blob = new Blob([bytes], { type: "image/x-portable-graymap" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "processed.pgm";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
