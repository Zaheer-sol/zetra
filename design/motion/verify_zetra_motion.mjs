import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const videoPath = resolve(process.argv[2] ?? "design/zetra-home-screen-motion.webm");
const screenshotPath = resolve(process.argv[3] ?? "design/zetra-home-screen-motion-preview.png");
const bytes = await readFile(videoPath);
const dataUrl = `data:video/webm;base64,${bytes.toString("base64")}`;

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.setContent('<video id="video" muted playsinline style="width:1920px;height:1080px;display:block"></video>');
const metadata = await page.evaluate(async (src) => {
  const video = document.getElementById("video");
  video.src = src;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("Video metadata failed to load"));
  });
  video.currentTime = Math.min(2.5, video.duration / 2);
  await new Promise((resolve) => {
    video.onseeked = resolve;
  });
  return {
    duration: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
    readyState: video.readyState
  };
}, dataUrl);

await page.locator("video").screenshot({ path: screenshotPath });
await browser.close();
console.log(JSON.stringify({ ...metadata, screenshotPath }, null, 2));
