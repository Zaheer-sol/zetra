import AVFoundation
import CoreGraphics
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import ImageIO

let sourcePath = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "design/zetra-home-screen-banner.png"
let outputPath = CommandLine.arguments.count > 2
    ? CommandLine.arguments[2]
    : "design/zetra-home-screen-motion.mp4"

let sourceURL = URL(fileURLWithPath: sourcePath)
let outputURL = URL(fileURLWithPath: outputPath)

guard
    let imageSource = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
    let sourceImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
else {
    fatalError("Could not load source image at \(sourcePath)")
}

try? FileManager.default.removeItem(at: outputURL)

let width = 1920
let height = 1080
let fps: Int32 = 30
let durationSeconds = 5
let frameCount = Int(fps) * durationSeconds
let sourceWidth = CGFloat(sourceImage.width)
let sourceHeight = CGFloat(sourceImage.height)
let sx = CGFloat(width) / sourceWidth
let sy = CGFloat(height) / sourceHeight

func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
    CGPoint(x: x * sx, y: y * sy)
}

func polygon(_ values: [(CGFloat, CGFloat)]) -> CGPath {
    let path = CGMutablePath()
    guard let first = values.first else { return path }
    path.move(to: point(first.0, first.1))
    for value in values.dropFirst() {
        path.addLine(to: point(value.0, value.1))
    }
    path.closeSubpath()
    return path
}

let smallCard = polygon([
    (718, 246), (910, 292), (918, 435), (721, 382)
])
let mainCard = polygon([
    (1168, 315), (1401, 382), (1403, 707), (1166, 602)
])
let rearCard = polygon([
    (1363, 222), (1556, 266), (1557, 490), (1366, 433)
])
let farCard = polygon([
    (1528, 158), (1672, 181), (1672, 379), (1531, 336)
])

let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let compression: [String: Any] = [
    AVVideoAverageBitRateKey: 12_000_000,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    AVVideoExpectedSourceFrameRateKey: fps,
    AVVideoMaxKeyFrameIntervalKey: Int(fps) * durationSeconds
]
let videoSettings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: compression
]
let writerInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
writerInput.expectsMediaDataInRealTime = false

let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: writerInput,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
    ]
)

guard writer.canAdd(writerInput) else {
    fatalError("Could not add video input")
}
writer.add(writerInput)

guard writer.startWriting() else {
    fatalError("Could not start writer: \(writer.error?.localizedDescription ?? "unknown error")")
}
writer.startSession(atSourceTime: .zero)

guard let pool = adaptor.pixelBufferPool else {
    fatalError("Could not create pixel buffer pool")
}

let colorSpace = CGColorSpaceCreateDeviceRGB()
let fullRect = CGRect(x: 0, y: 0, width: width, height: height)

func drawGlow(
    context: CGContext,
    center: CGPoint,
    radius: CGFloat,
    alpha: CGFloat
) {
    let colors = [
        CGColor(red: 0.18, green: 0.58, blue: 0.96, alpha: alpha),
        CGColor(red: 0.18, green: 0.58, blue: 0.96, alpha: 0)
    ] as CFArray
    guard let gradient = CGGradient(
        colorsSpace: colorSpace,
        colors: colors,
        locations: [0, 1]
    ) else { return }
    context.drawRadialGradient(
        gradient,
        startCenter: center,
        startRadius: 0,
        endCenter: center,
        endRadius: radius,
        options: []
    )
}

func bezierPoint(
    start: CGPoint,
    control1: CGPoint,
    control2: CGPoint,
    end: CGPoint,
    t: CGFloat
) -> CGPoint {
    let mt = 1 - t
    let x = mt * mt * mt * start.x
        + 3 * mt * mt * t * control1.x
        + 3 * mt * t * t * control2.x
        + t * t * t * end.x
    let y = mt * mt * mt * start.y
        + 3 * mt * mt * t * control1.y
        + 3 * mt * t * t * control2.y
        + t * t * t * end.y
    return CGPoint(x: x, y: y)
}

func drawCard(
    context: CGContext,
    path: CGPath,
    offsetY: CGFloat,
    alpha: CGFloat,
    edgeAlpha: CGFloat
) {
    context.saveGState()
    context.translateBy(x: 0, y: offsetY)
    context.addPath(path)
    context.clip()
    context.setAlpha(alpha)
    context.draw(sourceImage, in: fullRect)
    context.restoreGState()

    context.saveGState()
    context.translateBy(x: 0, y: offsetY)
    context.addPath(path)
    context.setStrokeColor(CGColor(red: 0.66, green: 0.79, blue: 0.94, alpha: edgeAlpha))
    context.setLineWidth(1.2)
    context.strokePath()
    context.restoreGState()
}

func renderFrame(_ frame: Int, into pixelBuffer: CVPixelBuffer) {
    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }

    guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    guard let context = CGContext(
        data: baseAddress,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
            | CGBitmapInfo.byteOrder32Little.rawValue
    ) else { return }

    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)

    let progress = CGFloat(frame) / CGFloat(frameCount)
    let phase = progress * 2 * .pi
    let breathe = (sin(phase) + 1) / 2

    // Keep the Zetra identity and tagline completely static.
    context.draw(sourceImage, in: fullRect)

    // Rebuild the right-side stage as a clean, dark motion field.
    context.saveGState()
    let coverRect = CGRect(
        x: point(610, 0).x,
        y: 0,
        width: CGFloat(width) - point(610, 0).x,
        height: point(0, 742).y
    )
    let coverColors = [
        CGColor(red: 0.055, green: 0.064, blue: 0.078, alpha: 0.92),
        CGColor(red: 0.025, green: 0.031, blue: 0.043, alpha: 0.985)
    ] as CFArray
    let coverGradient = CGGradient(
        colorsSpace: colorSpace,
        colors: coverColors,
        locations: [0, 1]
    )!
    context.clip(to: coverRect)
    context.drawLinearGradient(
        coverGradient,
        start: CGPoint(x: coverRect.minX, y: coverRect.minY),
        end: CGPoint(x: coverRect.maxX, y: coverRect.maxY),
        options: []
    )
    context.restoreGState()

    // A restrained perspective ledger grid.
    context.saveGState()
    context.setLineWidth(0.8)
    context.setStrokeColor(CGColor(red: 0.29, green: 0.38, blue: 0.50, alpha: 0.22))
    for index in 0..<9 {
        let y = point(0, 190 + CGFloat(index) * 61).y
        context.move(to: CGPoint(x: point(650, 0).x, y: y))
        context.addLine(to: CGPoint(x: CGFloat(width), y: y - CGFloat(index) * 5))
    }
    for index in 0..<10 {
        let x = point(710 + CGFloat(index) * 108, 0).x
        context.move(to: CGPoint(x: x, y: point(0, 150).y))
        context.addLine(to: CGPoint(x: x - 155, y: point(0, 742).y))
    }
    context.strokePath()
    context.restoreGState()

    // Independent, seamless card movement creates depth without disturbing the brand.
    drawCard(
        context: context,
        path: farCard,
        offsetY: 4.0 * sin(phase + 2.6),
        alpha: 0.43,
        edgeAlpha: 0.10
    )
    drawCard(
        context: context,
        path: rearCard,
        offsetY: 6.0 * sin(phase + 1.7),
        alpha: 0.60,
        edgeAlpha: 0.15
    )
    drawCard(
        context: context,
        path: smallCard,
        offsetY: 7.0 * sin(phase + 0.3),
        alpha: 0.92,
        edgeAlpha: 0.30
    )
    drawCard(
        context: context,
        path: mainCard,
        offsetY: 8.5 * sin(phase + 0.9),
        alpha: 1.0,
        edgeAlpha: 0.46 + 0.12 * breathe
    )

    // Payment path and verification pulse.
    let start = point(912, 372)
    let c1 = point(985, 389)
    let c2 = point(1054, 506)
    let end = point(1170, 500)
    let path = CGMutablePath()
    path.move(to: start)
    path.addCurve(to: end, control1: c1, control2: c2)

    context.saveGState()
    context.addPath(path)
    context.setStrokeColor(CGColor(red: 0.17, green: 0.58, blue: 0.98, alpha: 0.46))
    context.setLineWidth(2.0)
    context.strokePath()
    context.restoreGState()

    let travel = progress
    let bead = bezierPoint(start: start, control1: c1, control2: c2, end: end, t: travel)
    drawGlow(context: context, center: bead, radius: 30, alpha: 0.34)
    context.setFillColor(CGColor(red: 0.20, green: 0.63, blue: 1.0, alpha: 1.0))
    context.fillEllipse(in: CGRect(x: bead.x - 5, y: bead.y - 5, width: 10, height: 10))

    let verify = point(1070, 506)
    let pulse = 0.5 + 0.5 * sin(phase * 2 - 0.8)
    drawGlow(context: context, center: verify, radius: 42 + 14 * pulse, alpha: 0.24 + 0.12 * pulse)
    context.setStrokeColor(CGColor(red: 0.20, green: 0.63, blue: 1.0, alpha: 0.38 * (1 - pulse)))
    context.setLineWidth(2)
    context.strokeEllipse(
        in: CGRect(
            x: verify.x - 14 - 14 * pulse,
            y: verify.y - 14 - 14 * pulse,
            width: 28 + 28 * pulse,
            height: 28 + 28 * pulse
        )
    )
    context.setFillColor(CGColor(red: 0.20, green: 0.63, blue: 1.0, alpha: 1))
    context.fillEllipse(in: CGRect(x: verify.x - 8, y: verify.y - 8, width: 16, height: 16))

    // Small confirmation lights keep the outer field alive without adding noise.
    let particles: [(CGFloat, CGFloat, CGFloat)] = [
        (1464, 94, 0.1), (1218, 105, 0.35), (966, 204, 0.62),
        (1554, 311, 0.81), (1450, 520, 0.53), (1060, 668, 0.23)
    ]
    for particle in particles {
        let local = (progress + particle.2).truncatingRemainder(dividingBy: 1)
        let alpha = 0.20 + 0.55 * pow(max(0, sin(local * .pi)), 2)
        let p = point(particle.0, particle.1)
        context.setFillColor(CGColor(red: 0.18, green: 0.58, blue: 0.98, alpha: alpha))
        context.fillEllipse(in: CGRect(x: p.x - 3, y: p.y - 3, width: 6, height: 6))
    }
}

for frame in 0..<frameCount {
    while !writerInput.isReadyForMoreMediaData {
        usleep(1_000)
    }

    var pixelBuffer: CVPixelBuffer?
    let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer)
    guard status == kCVReturnSuccess, let buffer = pixelBuffer else {
        fatalError("Could not create frame \(frame)")
    }

    renderFrame(frame, into: buffer)
    let presentationTime = CMTime(value: CMTimeValue(frame), timescale: fps)
    guard adaptor.append(buffer, withPresentationTime: presentationTime) else {
        fatalError("Could not append frame \(frame): \(writer.error?.localizedDescription ?? "unknown error")")
    }

    if frame % 30 == 0 {
        print("Rendered frame \(frame)/\(frameCount)")
    }
}

writerInput.markAsFinished()
let completion = DispatchSemaphore(value: 0)
writer.finishWriting {
    completion.signal()
}
completion.wait()

guard writer.status == .completed else {
    fatalError("Writer failed: \(writer.error?.localizedDescription ?? "unknown error")")
}

print("Wrote \(outputURL.path)")
