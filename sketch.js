
// =====================================================
// MORPHSCAPE FINAL - WORKING VERSION RESTORED
// TWO HANDS = INDEX FINGERTIPS
// ONE FIST = PALM CENTRE
// ORIGINAL THREE-LAYER LUMINOUS TRAILS
// CAMERA PREVIEW ENABLED
// =====================================================

let handPose;
let video;
let hands = [];
let resetButton;
let trackingStatus;

const MS_COUNT = 16;
const MS_NEUTRAL = 90;
const MS_MIN = 5;
const MS_MAX = 180;

const msChannelForServo = [
  0, 1, 8, 9,
  2, 3, 10, 11,
  4, 5, 12, 13,
  6, 7, 14, 15
];

const msMountainUp = [
  110, 126, 119, 103,
  135, 166, 151, 114,
  124, 180, 159, 108,
  105, 132, 121, 99
];

const msMountainDown = [
  70, 55, 63, 76,
  47, 17, 31, 66,
  58, 5, 24, 72,
  79, 51, 61, 83
];

const msCoordinates = Array.from(
  { length: 16 },
  (_, i) => ({
    x: (i % 4) +
      (Math.floor(i / 4) % 2 ? 0.42 : 0),
    y: Math.floor(i / 4) * 0.92
  })
);

let msTargets = Array(MS_COUNT).fill(MS_NEUTRAL);
let msCurrent = Array(MS_COUNT).fill(MS_NEUTRAL);

let msTrails = [[], []];
let msTrailModes = ["", ""];
let msTrailPositions = [null, null];

let msMode = "READY";
let msTwoPrevious = null;
let msWideReference = null;
let msMountainDirection = 1;
let msGrip = null;
let msLastSend = 0;

// =====================================================
// SETUP - EXPERIMENT 1E FOUNDATION
// =====================================================

async function setup() {

  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);

  bleSetup();

  resetButton = createButton("RESET");
  resetButton.id("resetButton");
  resetButton.mousePressed(msReset);

  trackingStatus = createDiv("Starting hand tracking...");
  trackingStatus.id("trackingStatus");

  try {

    handPose = await ml5.handPose();

    video = createCapture({
      video: {
        facingMode: "user"
      },
      audio: false
    });

    video.size(640, 480);
    video.hide();

    handPose.detectStart(video, gotHands);

    trackingStatus.html("Hand tracking ready");

  } catch (error) {

    console.error(
      "Hand tracking startup failed:",
      error
    );

    trackingStatus.html(
      "Camera/hand tracking error: " +
      String(error.message || error)
    );
  }
}

// =====================================================
// HANDPOSE
// =====================================================

function gotHands(results) {
  hands = results;
}

function msClamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function msKey(hand, i) {
  return hand.keypoints && hand.keypoints[i];
}

function msScreen(hand, i) {

  const p = msKey(hand, i);

  return p ? {
    x: width - map(p.x, 0, 640, 0, width),
    y: map(p.y, 0, 480, 0, height)
  } : null;
}

// =====================================================
// INDEX FINGERTIP - TWO-HAND INTERACTION
// =====================================================

function msFingertip(hand) {
  return msScreen(hand, 8);
}

// =====================================================
// PALM CENTRE - LOCALISED FIST INTERACTION
// =====================================================

function msPalmCenter(hand) {

  const points = [0, 5, 9, 13, 17]
    .map(i => msScreen(hand, i))
    .filter(Boolean);

  if (!points.length) return null;

  return {
    x: points.reduce((s, p) => s + p.x, 0) /
      points.length,
    y: points.reduce((s, p) => s + p.y, 0) /
      points.length
  };
}

// =====================================================
// FIST DETECTION
// =====================================================

function msFistScore(hand) {

  const wrist = msKey(hand, 0);

  if (!wrist) return 0;

  let folded = 0;

  for (const [tip, base] of [
    [8, 5],
    [12, 9],
    [16, 13],
    [20, 17]
  ]) {

    const t = msKey(hand, tip);
    const b = msKey(hand, base);

    if (!t || !b) continue;

    if (
      Math.hypot(t.x - wrist.x, t.y - wrist.y) <
      1.45 * Math.hypot(
        b.x - wrist.x,
        b.y - wrist.y
      )
    ) {
      folded++;
    }
  }

  return folded / 4;
}

// =====================================================
// RESET
// =====================================================

function msReset() {

  msTargets.fill(90);
  msCurrent.fill(90);

  msMode = "READY";
  msTwoPrevious = null;
  msWideReference = null;
  msMountainDirection = 1;
  msGrip = null;

  msTrails = [[], []];
  msTrailModes = ["", ""];
  msTrailPositions = [null, null];

  sendResetCommand();
}

// =====================================================
// GESTURE INTERACTIONS
// =====================================================

function msUpdateGesture() {

  const detected = hands
    .map(h => ({
      hand: h,
      fingertip: msFingertip(h),
      palm: msPalmCenter(h),
      fist: msFistScore(h)
    }))
    .filter(h => h.fingertip || h.palm);

  // TWO-HAND MOUNTAIN / VALLEY
  if (
    detected.length >= 2 &&
    detected[0].fingertip &&
    detected[1].fingertip
  ) {

    msGrip = null;

    const a = detected[0].fingertip;
    const b = detected[1].fingertip;

    const separation = Math.hypot(
      a.x - b.x,
      a.y - b.y
    ) / Math.max(width, height);

    const midY = (a.y + b.y) / (2 * height);

    if (!msTwoPrevious) {
      msTwoPrevious = { separation, midY };
      msWideReference = separation;
    }

    const deltaSep =
      separation - msTwoPrevious.separation;

    const deltaY =
      midY - msTwoPrevious.midY;

    if (
      deltaSep < -0.004 &&
      Math.abs(deltaY) > 0.002
    ) {
      msMountainDirection = deltaY < 0 ? 1 : -1;
    }

    msWideReference = Math.max(
      msWideReference,
      separation
    );

    const strength = msClamp(
      (msWideReference - separation) / 0.38,
      0,
      1
    );

    const shape =
      msMountainDirection === 1
        ? msMountainUp
        : msMountainDown;

    for (let i = 0; i < MS_COUNT; i++) {
      msTargets[i] =
        90 + (shape[i] - 90) * strength;
    }

    msTwoPrevious = { separation, midY };

    msMode =
      msMountainDirection === 1
        ? "MOUNTAIN"
        : "VALLEY";

    return;
  }

  msTwoPrevious = null;
  msWideReference = null;

  // ONE-HAND LOCALISED PULL
  if (
    detected.length === 1 &&
    detected[0].fist >= 0.63 &&
    detected[0].palm
  ) {

    const p = detected[0].palm;

    if (!msGrip) {

      const px = msClamp(
        p.x / width, 0, 1
      ) * 3.42;

      const py = msClamp(
        p.y / height, 0, 1
      ) * 2.76;

      let best = 0;
      let nearest = Infinity;

      for (let i = 0; i < MS_COUNT; i++) {

        const d = Math.hypot(
          msCoordinates[i].x - px,
          msCoordinates[i].y - py
        );

        if (d < nearest) {
          nearest = d;
          best = i;
        }
      }

      msGrip = {
        index: best,
        startY: p.y,
        startAngle: msCurrent[best]
      };
    }

    const travel = msClamp(
      (msGrip.startY - p.y) / (height * 0.33),
      -1,
      1
    );

    const target = msClamp(
      msGrip.startAngle +
      travel * (travel >= 0 ? 90 : 85),
      MS_MIN,
      MS_MAX
    );

    const origin = msCoordinates[msGrip.index];

    for (let i = 0; i < MS_COUNT; i++) {

      const d = Math.hypot(
        msCoordinates[i].x - origin.x,
        msCoordinates[i].y - origin.y
      );

      const weight = Math.exp(-1.7 * d * d);

      msTargets[i] =
        90 + (target - 90) * weight;
    }

    msMode = "LOCAL PULL";
    return;
  }

  msGrip = null;
  msTargets.fill(90);
  msMode = "RELEASE";
}

// =====================================================
// ORIGINAL WORKING LUMINOUS TRAILS
// =====================================================

function msBrushPalette(direction) {
  // Upward = warm summer colors. Downward = aqua/ocean colors.
  return direction === "down"
    ? [
        [20, 245, 220],  // bright aqua
        [0, 205, 205],   // turquoise
        [35, 165, 235],  // aqua blue
        [80, 125, 255]   // cool blue
      ]
    : [
        [255, 92, 150],  // summer coral pink
        [255, 135,  90], // warm pink-orange
        [255, 185,  70], // sunny orange
        [255, 225, 125]  // soft summer yellow
      ];
}

function msBlendBrushPalette(palette, t) {
  const scaled = msClamp(t, 0, 1) * (palette.length - 1);
  const index = Math.min(
    Math.floor(scaled),
    palette.length - 2
  );
  const amount = scaled - index;

  return palette[index].map((value, channel) =>
    value + (palette[index + 1][channel] - value) * amount
  );
}

function msDrawBrushSegment(a, b, rgb, fade, width) {
  const ctx = drawingContext;
  const color = `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])},`;

  // Large soft atmospheric halo.
  ctx.save();
  ctx.shadowColor = `${color}${Math.max(0.18, fade * 0.32)})`;
  ctx.shadowBlur = width * 3.8;
  stroke(rgb[0], rgb[1], rgb[2], fade * 48);
  strokeWeight(width * 3.1);
  strokeCap(ROUND);
  line(a.x, a.y, b.x, b.y);
  ctx.restore();

  // Colored luminous body.
  ctx.save();
  ctx.shadowColor = `${color}${Math.max(0.25, fade * 0.55)})`;
  ctx.shadowBlur = width * 1.8;
  stroke(rgb[0], rgb[1], rgb[2], fade * 145);
  strokeWeight(width * 1.45);
  strokeCap(ROUND);
  line(a.x, a.y, b.x, b.y);
  ctx.restore();

  // Bright, colored brush center. It is not a flat white line.
  stroke(
    Math.min(255, rgb[0] + 48),
    Math.min(255, rgb[1] + 48),
    Math.min(255, rgb[2] + 48),
    fade * 205
  );
  strokeWeight(Math.max(2.2, width * 0.42));
  strokeCap(ROUND);
  line(a.x, a.y, b.x, b.y);
}

function msDrawTrails() {

  const now = millis();

  const detected = hands
    .map(h => ({
      fingertip: msFingertip(h),
      palm: msPalmCenter(h),
      fist: msFistScore(h)
    }))
    .filter(h => h.fingertip || h.palm);

  let positions = [];
  let modes = [];

  if (detected.length >= 2) {
    positions = detected.slice(0, 2).map(h => h.fingertip);
    modes = ["FINGERTIP", "FINGERTIP"];
  } else if (
    detected.length === 1 &&
    detected[0].fist >= 0.63
  ) {
    positions = [detected[0].palm];
    modes = ["PALM"];
  } else if (detected.length === 1) {
    positions = [detected[0].fingertip];
    modes = ["FINGERTIP"];
  }

  for (let i = 0; i < 2; i++) {

    const p = positions[i] || null;
    const mode = modes[i] || "";

    if (mode !== msTrailModes[i]) {
      msTrails[i] = [];
      msTrailPositions[i] = null;
      msTrailModes[i] = mode;
    }

    if (p) {
      const old = msTrailPositions[i];
      const jump = old
        ? Math.hypot(p.x - old.x, p.y - old.y)
        : 0;

      if (!old || jump < Math.max(width, height) * 0.22) {
        const down = old && p.y - old.y > 1.5;

        msTrails[i].push({
          x: p.x,
          y: p.y,
          time: now,
          direction: down ? "down" : "up"
        });

        msTrailPositions[i] = p;
      }
    }

    msTrails[i] = msTrails[i].filter(
      pt => now - pt.time < 900
    );

    const trail = msTrails[i];

    for (let j = 1; j < trail.length; j++) {
      const a = trail[j - 1];
      const b = trail[j];
      const life = msClamp(
        1 - (now - b.time) / 900,
        0,
        1
      );
      const along = j / Math.max(1, trail.length - 1);
      const fade = life * (0.25 + 0.75 * along);
      const palette = msBrushPalette(b.direction);
      const rgb = msBlendBrushPalette(palette, along);
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const width = msClamp(
        5 + distance * 0.42 + 17 * fade,
        5,
        29
      );

      msDrawBrushSegment(a, b, rgb, fade, width);
    }

    // A small glowing tip gives the brush its energetic leading edge.
    if (p && trail.length) {
      const newest = trail[trail.length - 1];
      const palette = msBrushPalette(newest.direction);
      const rgb = palette[0];

      drawingContext.save();
      drawingContext.shadowColor = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.8)`;
      drawingContext.shadowBlur = 22;
      noStroke();
      fill(rgb[0], rgb[1], rgb[2], 115);
      circle(p.x, p.y, 13);
      drawingContext.restore();
    }
  }
}

// =====================================================
// 36-UNIT CONFIGURATION MAP
// =====================================================

function msDrawGrid() {

  const diameter = Math.min(
    width / 14,
    height / 10,
    44
  );

  const gap = diameter * 1.16;

  const left = width / 2 - 2.7 * gap;
  const top = height / 2 - 2.5 * gap;

  textAlign(CENTER, CENTER);

  for (let row = 0; row < 6; row++) {

    for (let col = 0; col < 6; col++) {

      const x =
        left + col * gap +
        (row % 2 ? gap * 0.4 : 0);

      const y = top + row * gap;

      const active =
        row >= 1 && row <= 4 &&
        col >= 1 && col <= 4;

      strokeWeight(1);

      stroke(
        active
          ? color(85, 205, 210, 170)
          : color(130, 130, 130, 90)
      );

      fill(
        active
          ? color(8, 70, 78, 130)
          : color(115, 115, 115, 75)
      );

      circle(x, y, diameter);

      if (active) {

        const number = (row - 1) * 4 + col;

        noStroke();
        fill(245);

        textSize(Math.max(11, diameter * 0.33));

        text(
          number,
          x,
          y - diameter * 0.15
        );

        textSize(Math.max(8, diameter * 0.22));

        text(
          Math.round(msCurrent[number - 1]) + "°",
          x,
          y + diameter * 0.19
        );
      }
    }
  }
}

// =====================================================
// DRAW
// =====================================================

function draw() {

  background(0);

  // MIRRORED CAMERA PREVIEW
  if (
    video &&
    video.elt &&
    video.elt.readyState >= 2
  ) {

    push();
    translate(width, 0);
    scale(-1, 1);

    image(video, 0, 0, width, height);

    pop();
  }

  msUpdateGesture();

  const ease =
    msMode === "RELEASE" ? 0.13 : 0.28;

  for (let i = 0; i < MS_COUNT; i++) {
    msCurrent[i] +=
      (msTargets[i] - msCurrent[i]) * ease;
  }

  msDrawTrails();
  msDrawGrid();

  noStroke();
  fill(245);

  textAlign(CENTER, CENTER);
  textSize(15);

  text(msMode, width / 2, 45);

  // BLE SERVO ANGLE UPDATES
  const now = millis();

  if (
    bleConnected &&
    now - msLastSend >= 100
  ) {

    const channels = Array(16).fill(MS_NEUTRAL);

    for (let i = 0; i < MS_COUNT; i++) {

      channels[msChannelForServo[i]] =
        Math.round(msCurrent[i]);
    }

    sendAngles(channels);
    msLastSend = now;
  }
}

// =====================================================
// WINDOW RESIZE
// =====================================================

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
