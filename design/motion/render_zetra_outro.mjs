import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const logoPath = resolve(process.argv[2] ?? "/Users/mac/Downloads/zetra-logo-horizontal-dark.png");
const outputPath = resolve(process.argv[3] ?? "design/zetra-pitch-outro-raw.webm");
const logoBytes = await readFile(logoPath);
const logoDataUrl = `data:image/png;base64,${logoBytes.toString("base64")}`;

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

await page.setContent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #07090d; }
      canvas { display: block; width: 1920px; height: 1080px; }
    </style>
  </head>
  <body>
    <canvas id="canvas" width="1920" height="1080"></canvas>
    <script>
      window.renderZetraOutro = async (logoDataUrl) => {
        const canvas = document.getElementById("canvas");
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        const width = canvas.width;
        const height = canvas.height;
        const duration = 5000;

        const logo = new Image();
        logo.src = logoDataUrl;
        await logo.decode();

        const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
        const easeOutCubic = (value) => 1 - Math.pow(1 - clamp(value), 3);
        const easeInOutCubic = (value) => {
          const x = clamp(value);
          return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
        };

        function drawBackground(seconds) {
          ctx.fillStyle = "#07090d";
          ctx.fillRect(0, 0, width, height);

          const radial = ctx.createRadialGradient(960, 420, 40, 960, 420, 850);
          radial.addColorStop(0, "rgba(22,34,50,0.72)");
          radial.addColorStop(0.48, "rgba(10,15,24,0.56)");
          radial.addColorStop(1, "rgba(4,6,10,0)");
          ctx.fillStyle = radial;
          ctx.fillRect(0, 0, width, height);

          ctx.save();
          ctx.strokeStyle = "rgba(95,126,164,0.12)";
          ctx.lineWidth = 1;
          for (let x = 140; x < width; x += 130) {
            ctx.beginPath();
            ctx.moveTo(x, 90);
            ctx.lineTo(x - 190, height - 90);
            ctx.stroke();
          }
          for (let y = 160; y < height; y += 112) {
            ctx.beginPath();
            ctx.moveTo(90, y);
            ctx.lineTo(width - 90, y);
            ctx.stroke();
          }
          ctx.restore();

          const particles = [
            [260, 220, 0.1], [1550, 190, 0.55], [1690, 720, 0.78],
            [340, 840, 0.32], [1460, 870, 0.88], [1080, 150, 0.65]
          ];
          for (const [x, y, offset] of particles) {
            const pulse = 0.32 + 0.46 * (0.5 + 0.5 * Math.sin(seconds * 1.5 + offset * Math.PI * 2));
            ctx.fillStyle = "rgba(47,149,245," + pulse + ")";
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        function drawSignal(seconds) {
          const reveal = easeInOutCubic(seconds / 1.05);
          const fade = 1 - easeOutCubic((seconds - 1.2) / 0.65);
          if (fade <= 0) return;

          const startX = 350;
          const endX = 1570;
          const y = 535;
          const dotX = startX + (endX - startX) * reveal;

          ctx.save();
          ctx.globalAlpha = fade;
          const line = ctx.createLinearGradient(startX, y, endX, y);
          line.addColorStop(0, "rgba(47,149,245,0)");
          line.addColorStop(0.28, "rgba(47,149,245,0.44)");
          line.addColorStop(0.68, "rgba(47,149,245,0.92)");
          line.addColorStop(1, "rgba(47,149,245,0)");
          ctx.strokeStyle = line;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(startX, y);
          ctx.lineTo(dotX, y);
          ctx.stroke();

          const glow = ctx.createRadialGradient(dotX, y, 0, dotX, y, 56);
          glow.addColorStop(0, "rgba(47,149,245,0.72)");
          glow.addColorStop(1, "rgba(47,149,245,0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(dotX, y, 56, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#2f95f5";
          ctx.beginPath();
          ctx.arc(dotX, y, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        function drawCenteredText(text, y, font, color, alpha, tracking = 0) {
          ctx.save();
          ctx.globalAlpha = clamp(alpha);
          ctx.fillStyle = color;
          ctx.font = font;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          if (!tracking) {
            ctx.fillText(text, width / 2, y);
          } else {
            const widths = [...text].map((letter) => ctx.measureText(letter).width);
            const total = widths.reduce((sum, value) => sum + value, 0) + tracking * (text.length - 1);
            let x = width / 2 - total / 2;
            [...text].forEach((letter, index) => {
              ctx.fillText(letter, x + widths[index] / 2, y);
              x += widths[index] + tracking;
            });
          }
          ctx.restore();
        }

        function drawFrame(progress) {
          const seconds = progress * 5;
          drawBackground(seconds);
          drawSignal(seconds);

          const logoReveal = easeOutCubic((seconds - 0.72) / 0.9);
          const logoScale = 0.965 + 0.035 * logoReveal;
          const logoWidth = 1040 * logoScale;
          const logoHeight = 364 * logoScale;
          const logoX = (width - logoWidth) / 2;
          const logoY = 255 + (1 - logoReveal) * 24;

          ctx.save();
          ctx.globalAlpha = logoReveal;
          const halo = ctx.createRadialGradient(960, 505, 40, 960, 505, 390);
          halo.addColorStop(0, "rgba(47,149,245," + (0.11 * logoReveal) + ")");
          halo.addColorStop(1, "rgba(47,149,245,0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(960, 505, 390, 0, Math.PI * 2);
          ctx.fill();
          ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
          ctx.restore();

          const taglineReveal = easeOutCubic((seconds - 1.55) / 0.72);
          drawCenteredText(
            "Get paid in stablecoins. Your books are already done.",
            700 + (1 - taglineReveal) * 15,
            "500 36px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            "#f7f8fa",
            taglineReveal
          );

          const detailsReveal = easeOutCubic((seconds - 2.18) / 0.62);
          const separatorWidth = 120 * detailsReveal;
          ctx.save();
          ctx.globalAlpha = detailsReveal;
          ctx.fillStyle = "rgba(47,149,245,0.92)";
          ctx.fillRect(width / 2 - separatorWidth / 2, 759, separatorWidth, 2);
          ctx.restore();

          drawCenteredText(
            "PAYMENTS, RECONCILED",
            806,
            "600 18px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            "#7fbfff",
            detailsReveal,
            4.2
          );
          drawCenteredText(
            "SET YOUR API URL",
            864,
            "500 24px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            "rgba(224,230,239,0.82)",
            detailsReveal
          );
        }

        drawFrame(0);
        const stream = canvas.captureStream(30);
        const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
        const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
        if (!mimeType) throw new Error("This browser cannot record WebM");

        const chunks = [];
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 14_000_000 });
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };

        const complete = new Promise((resolve, reject) => {
          recorder.onerror = (event) => reject(event.error);
          recorder.onstop = async () => {
            const blob = new Blob(chunks, { type: mimeType });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = "";
            const chunkSize = 0x8000;
            for (let index = 0; index < bytes.length; index += chunkSize) {
              binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
            }
            resolve({ base64: btoa(binary), mimeType, size: bytes.length });
          };
        });

        recorder.start(1000);
        const startedAt = performance.now();
        await new Promise((resolve) => {
          const animate = (now) => {
            const elapsed = now - startedAt;
            drawFrame(Math.min(elapsed, duration) / duration);
            if (elapsed < duration + 300) requestAnimationFrame(animate);
            else resolve();
          };
          requestAnimationFrame(animate);
        });
        drawFrame(1);
        await new Promise((resolve) => setTimeout(resolve, 70));
        recorder.stop();
        return complete;
      };
    </script>
  </body>
</html>`);

const result = await page.evaluate(async (dataUrl) => {
  return window.renderZetraOutro(dataUrl);
}, logoDataUrl);

await writeFile(outputPath, Buffer.from(result.base64, "base64"));
await browser.close();

console.log(JSON.stringify({ outputPath, mimeType: result.mimeType, size: result.size }, null, 2));
