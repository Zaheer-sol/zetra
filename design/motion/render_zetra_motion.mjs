import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = resolve(process.argv[2] ?? "design/zetra-home-screen-banner.png");
const outputPath = resolve(process.argv[3] ?? "design/zetra-home-screen-motion.webm");
const imageBytes = await readFile(sourcePath);
const imageDataUrl = `data:image/png;base64,${imageBytes.toString("base64")}`;

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
      window.renderZetraMotion = async (imageDataUrl) => {
        const canvas = document.getElementById("canvas");
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        const width = canvas.width;
        const height = canvas.height;
        const duration = 5000;
        const sourceWidth = 1672;
        const sourceHeight = 941;
        const sx = width / sourceWidth;
        const sy = height / sourceHeight;
        const px = (x) => x * sx;
        const py = (y) => y * sy;

        const image = new Image();
        image.src = imageDataUrl;
        await image.decode();

        const coverCanvas = document.createElement("canvas");
        coverCanvas.width = width;
        coverCanvas.height = height;
        const coverCtx = coverCanvas.getContext("2d");
        const coverColor = coverCtx.createLinearGradient(px(610), 0, width, py(700));
        coverColor.addColorStop(0, "rgb(14,16,20)");
        coverColor.addColorStop(1, "rgb(6,8,12)");
        coverCtx.fillStyle = coverColor;
        coverCtx.fillRect(0, 0, width, height);
        coverCtx.globalCompositeOperation = "destination-in";
        const horizontalMask = coverCtx.createLinearGradient(px(600), 0, px(835), 0);
        horizontalMask.addColorStop(0, "rgba(0,0,0,0)");
        horizontalMask.addColorStop(0.76, "rgba(0,0,0,0.95)");
        horizontalMask.addColorStop(1, "rgba(0,0,0,1)");
        coverCtx.fillStyle = horizontalMask;
        coverCtx.fillRect(0, 0, width, height);
        const verticalMask = coverCtx.createLinearGradient(0, py(510), 0, py(750));
        verticalMask.addColorStop(0, "rgba(0,0,0,1)");
        verticalMask.addColorStop(0.52, "rgba(0,0,0,0.94)");
        verticalMask.addColorStop(1, "rgba(0,0,0,0)");
        coverCtx.fillStyle = verticalMask;
        coverCtx.fillRect(0, 0, width, height);
        coverCtx.globalCompositeOperation = "source-over";

        const cards = [
          { points: [[1528,158],[1672,181],[1672,379],[1531,336]], amplitudeX: 5, amplitudeY: 9, phase: 2.6, alpha: 0.54 },
          { points: [[1363,222],[1556,266],[1557,490],[1366,433]], amplitudeX: 7, amplitudeY: 12, phase: 1.7, alpha: 0.72 },
          { points: [[718,246],[910,292],[918,435],[721,382]], amplitudeX: 10, amplitudeY: 16, phase: 0.3, alpha: 1.0 },
          { points: [[1168,315],[1401,382],[1403,707],[1166,602]], amplitudeX: 8, amplitudeY: 18, phase: 0.9, alpha: 1.0, highlight: true }
        ];

        const particles = [
          [1464,94,0.10], [1218,105,0.35], [966,204,0.62],
          [1554,311,0.81], [1450,520,0.53], [1060,668,0.23]
        ];

        function roundedGlow(x, y, radius, alpha) {
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, "rgba(47,149,245," + alpha + ")");
          gradient.addColorStop(1, "rgba(47,149,245,0)");
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        function cardPath(points, offsetX, offsetY) {
          ctx.beginPath();
          ctx.moveTo(px(points[0][0]) + offsetX, py(points[0][1]) + offsetY);
          for (const point of points.slice(1)) {
            ctx.lineTo(px(point[0]) + offsetX, py(point[1]) + offsetY);
          }
          ctx.closePath();
        }

        function drawCard(card, phase, progress) {
          const offsetX = card.amplitudeX * Math.cos(phase + card.phase);
          const offsetY = card.amplitudeY * Math.sin(phase + card.phase);
          ctx.save();
          cardPath(card.points, offsetX, offsetY);
          ctx.clip();
          ctx.globalAlpha = card.alpha;
          ctx.drawImage(image, 0, 0, width, height);

          if (card.highlight) {
            const sweepX = px(1110) + progress * px(390);
            const sheen = ctx.createLinearGradient(sweepX - 70, 0, sweepX + 70, 0);
            sheen.addColorStop(0, "rgba(120,196,255,0)");
            sheen.addColorStop(0.48, "rgba(120,196,255,0.03)");
            sheen.addColorStop(0.5, "rgba(180,224,255,0.24)");
            sheen.addColorStop(0.52, "rgba(120,196,255,0.03)");
            sheen.addColorStop(1, "rgba(120,196,255,0)");
            ctx.fillStyle = sheen;
            ctx.fillRect(sweepX - 80, py(285), 160, py(450));
          }
          ctx.restore();

          ctx.save();
          cardPath(card.points, offsetX, offsetY);
          ctx.strokeStyle = "rgba(184,220,255," + (0.25 + card.alpha * 0.28) + ")";
          ctx.lineWidth = card.highlight ? 2.2 : 1.7;
          ctx.stroke();
          ctx.restore();
        }

        function bezier(a, b, c, d, t) {
          const mt = 1 - t;
          return {
            x: mt*mt*mt*a.x + 3*mt*mt*t*b.x + 3*mt*t*t*c.x + t*t*t*d.x,
            y: mt*mt*mt*a.y + 3*mt*mt*t*b.y + 3*mt*t*t*c.y + t*t*t*d.y
          };
        }

        function drawFrame(progress) {
          const phase = progress * Math.PI * 2;
          ctx.globalAlpha = 1;
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(image, 0, 0, width, height);

          // Clean motion field on the right. The logo and tagline remain untouched.
          ctx.drawImage(coverCanvas, 0, 0);

          // Restrained perspective ledger grid.
          ctx.save();
          ctx.strokeStyle = "rgba(83,112,151,0.31)";
          ctx.lineWidth = 1.0;
          for (let index = 0; index < 9; index += 1) {
            const y = py(190 + index * 61);
            ctx.beginPath();
            ctx.moveTo(px(650), y);
            ctx.lineTo(width, y - index * 5);
            ctx.stroke();
          }
          for (let index = 0; index < 10; index += 1) {
            const x = px(710 + index * 108);
            ctx.beginPath();
            ctx.moveTo(x, py(150));
            ctx.lineTo(x - 155, py(742));
            ctx.stroke();
          }
          ctx.restore();

          for (const card of cards) drawCard(card, phase, progress);

          const start = { x: px(912), y: py(372) };
          const c1 = { x: px(985), y: py(389) };
          const c2 = { x: px(1054), y: py(506) };
          const end = { x: px(1170), y: py(500) };

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
          ctx.strokeStyle = "rgba(47,149,245,0.88)";
          ctx.lineWidth = 3.4;
          ctx.stroke();
          ctx.restore();

          const bead = bezier(start, c1, c2, end, progress);
          roundedGlow(bead.x, bead.y, 50, 0.68);
          ctx.fillStyle = "rgb(51,161,255)";
          ctx.beginPath();
          ctx.arc(bead.x, bead.y, 8, 0, Math.PI * 2);
          ctx.fill();

          for (let trail = 1; trail <= 4; trail += 1) {
            const trailProgress = (progress - trail * 0.022 + 1) % 1;
            const trailPoint = bezier(start, c1, c2, end, trailProgress);
            ctx.fillStyle = "rgba(68,170,255," + (0.42 / trail) + ")";
            ctx.beginPath();
            ctx.arc(trailPoint.x, trailPoint.y, 6 - trail * 0.7, 0, Math.PI * 2);
            ctx.fill();
          }

          const verify = { x: px(1070), y: py(506) };
          const pulse = 0.5 + 0.5 * Math.sin(phase * 2 - 0.8);
          roundedGlow(verify.x, verify.y, 58 + 20 * pulse, 0.42 + 0.24 * pulse);
          ctx.strokeStyle = "rgba(51,161,255," + (0.72 * (1 - pulse)) + ")";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(verify.x, verify.y, 18 + 24 * pulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = "rgb(51,161,255)";
          ctx.beginPath();
          ctx.arc(verify.x, verify.y, 11, 0, Math.PI * 2);
          ctx.fill();

          for (const [x, y, offset] of particles) {
            const local = (progress + offset) % 1;
            const alpha = 0.30 + 0.70 * Math.pow(Math.max(0, Math.sin(local * Math.PI)), 2);
            ctx.fillStyle = "rgba(47,149,245," + alpha + ")";
            ctx.beginPath();
            ctx.arc(px(x), py(y), 4, 0, Math.PI * 2);
            ctx.fill();
          }

        }

        drawFrame(0);
        const stream = canvas.captureStream(30);
        const mimeCandidates = [
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm"
        ];
        const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
        if (!mimeType) throw new Error("This browser cannot record WebM");

        const chunks = [];
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 12_000_000
        });
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
            drawFrame((elapsed % duration) / duration);
            if (elapsed < duration + 300) requestAnimationFrame(animate);
            else resolve();
          };
          requestAnimationFrame(animate);
        });
        drawFrame(0);
        await new Promise((resolve) => setTimeout(resolve, 50));
        recorder.stop();
        return complete;
      };
    </script>
  </body>
</html>`);

const result = await page.evaluate(async (dataUrl) => {
  return window.renderZetraMotion(dataUrl);
}, imageDataUrl);

await writeFile(outputPath, Buffer.from(result.base64, "base64"));
await browser.close();

console.log(JSON.stringify({ outputPath, mimeType: result.mimeType, size: result.size }, null, 2));
