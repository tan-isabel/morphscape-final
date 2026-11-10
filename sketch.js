
// =====================================================
// MORPHSCAPE FINAL - HAND TRACKING + BLE
//
// 36 physical units, central 16 active
// PCA9685 address 0x40
// ESP32-S3 SDA GPIO 8 / SCL GPIO 9
//
// CAMERA PREVIEW ENABLED FOR DEBUGGING
// GLOWING TRAILS FOLLOW INDEX FINGERTIPS
// =====================================================

// =====================================================
// HAND TRACKING
// =====================================================

let handPose;
let video;
let hands = [];
let resetButton;
let trackingStatus;

// =====================================================
// SERVO SETTINGS
// =====================================================

const MS_COUNT = 16;
const MS_NEUTRAL = 90;
const MS_MIN = 5;
const MS_MAX = 180;

// Confirmed servo-to-PCA channel mapping
const msChannelForServo = [
  0, 1, 8, 9,
  2, 3, 10, 11,
  4, 5, 12, 13,
  6, 7, 14, 15
];

// Maximum convex mountain
const msMountainUp = [
  110, 126, 119, 103,
  135, 166, 151, 114,
  124, 180, 159, 108,
  105, 132, 121, 99
];

// Maximum concave mountain
const msMountainDown = [
  70, 55, 63, 76,
  47, 17, 31, 66,
  58, 5, 24, 72,
  79, 51, 61, 83
];

// Staggered 4 x 4 coordinates
const msCoordinates = Array.from(
  { length: 16 },
  (_, i) => ({
    x: (i % 4) +
      (Math.floor(i / 4) % 2 ? 0.42 : 0),

    y: Math.floor(i / 4) * 0.92
  })
);

// =====================================================
// SERVO STATE
// =====================================================

let msTargets =
  Array(MS_COUNT).fill(MS_NEUTRAL);

let msCurrent =
  Array(MS_COUNT).fill(MS_NEUTRAL);

let msTrails = [[], []];

let msMode = "READY";

let msTwoPrevious = null;
let msWideReference = null;
let msMountainDirection = 1;

let msGrip = null;

let msLastSend = 0;
let msLastHands = 0;

// =====================================================
// SETUP - EXPERIMENT 1E FOUNDATION
// =====================================================

async function setup() {

  createCanvas(
    windowWidth,
    windowHeight
  );

  pixelDensity(1);

  // Original Experiment 1E BLE setup
  bleSetup();

  // RESET button
  resetButton =
    createButton("RESET");

  resetButton.id("resetButton");

  resetButton.mousePressed(msReset);

  // Tracking status
  trackingStatus =
    createDiv("Starting hand tracking...");

  trackingStatus.id("trackingStatus");

  try {

    // Original Experiment 1E HandPose setup
    handPose =
      await ml5.handPose();

    video =
      createCapture({
        video: {
          facingMode: "user"
        },
        audio: false
      });

    video.size(640, 480);
    video.hide();

    handPose.detectStart(
      video,
      gotHands
    );

    trackingStatus.html(
      "Hand tracking ready"
    );

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
// HANDPOSE CALLBACK
// =====================================================

function gotHands(results) {

  hands = results;
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function msClamp(v, lo, hi) {

  return Math.max(
    lo,
    Math.min(hi, v)
  );
}

function msKey(hand, i) {

  return hand.keypoints &&
    hand.keypoints[i];
}

// =====================================================
// CONVERT HANDPOSE COORDINATES TO SCREEN
// MIRRORED SELFIE VIEW
// =====================================================

function msScreen(hand, i) {

  const p = msKey(hand, i);

  return p ? {

    x: width - map(
      p.x,
      0,
      640,
      0,
      width
    ),

    y: map(
      p.y,
      0,
      480,
      0,
      height
    )

  } : null;
}

// =====================================================
// INDEX FINGERTIP TRACKING
//
// CHANGED FROM PALM CENTRE TO INDEX FINGERTIP
// HANDPOSE LANDMARK 8
// =====================================================

function msCenter(hand) {

  const fingertip =
    msScreen(hand, 8);

  if (!fingertip) {
    return null;
  }

  return {

    x: fingertip.x,
    y: fingertip.y

  };
}

// =====================================================
// FIST DETECTION
// =====================================================

function msFistScore(hand) {

  const wrist =
    msKey(hand, 0);

  if (!wrist) {
    return 0;
  }

  let folded = 0;

  for (const [tip, base] of [
    [8, 5],
    [12, 9],
    [16, 13],
    [20, 17]
  ]) {

    const t =
      msKey(hand, tip);

    const b =
      msKey(hand, base);

    if (!t || !b) {
      continue;
    }

    if (
      Math.hypot(
        t.x - wrist.x,
        t.y - wrist.y
      ) <
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

  sendResetCommand();
}

// =====================================================
// GESTURE INTERACTIONS
// =====================================================

function msUpdateGesture() {

  const detected = hands
    .map(h => ({

      hand: h,
      p: msCenter(h),
      fist: msFistScore(h)

    }))
    .filter(h => h.p);

  // ===================================================
  // TWO-HAND LARGE-SCALE MOUNTAIN / VALLEY
  // ===================================================

  if (detected.length >= 2) {

    msGrip = null;

    const a =
      detected[0].p;

    const b =
      detected[1].p;

    const separation =
      Math.hypot(
        a.x - b.x,
        a.y - b.y
      ) / Math.max(width, height);

    const midY =
      (a.y + b.y) / (2 * height);

    if (!msTwoPrevious) {

      msTwoPrevious = {
        separation,
        midY
      };

      msWideReference =
        separation;
    }

    const deltaSep =
      separation -
      msTwoPrevious.separation;

    const deltaY =
      midY -
      msTwoPrevious.midY;

    if (
      deltaSep < -0.004 &&
      Math.abs(deltaY) > 0.002
    ) {

      msMountainDirection =
        deltaY < 0 ? 1 : -1;
    }

    msWideReference =
      Math.max(
        msWideReference,
        separation
      );

    const strength =
      msClamp(
        (msWideReference - separation) / 0.38,
        0,
        1
      );

    const shape =
      msMountainDirection === 1
        ? msMountainUp
        : msMountainDown;

    for (
      let i = 0;
      i < MS_COUNT;
      i++
    ) {

      msTargets[i] =
        MS_NEUTRAL +
        (shape[i] - MS_NEUTRAL) *
        strength;
    }

    msTwoPrevious = {
      separation,
      midY
    };

    msMode =
      msMountainDirection === 1
        ? "MOUNTAIN"
        : "VALLEY";

    return;
  }

  msTwoPrevious = null;
  msWideReference = null;

  // ===================================================
  // ONE-HAND LOCALISED PULLING
  // ===================================================

  if (
    detected.length === 1 &&
    detected[0].fist >= 0.63
  ) {

    const p =
      detected[0].p;

    if (!msGrip) {

      const px =
        msClamp(
          p.x / width,
          0,
          1
        ) * 3.42;

      const py =
        msClamp(
          p.y / height,
          0,
          1
        ) * 2.76;

      let best = 0;
      let nearest = Infinity;

      for (
        let i = 0;
        i < MS_COUNT;
        i++
      ) {

        const d =
          Math.hypot(
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
        startAngle:
          msCurrent[best]

      };
    }

    const travel =
      msClamp(
        (
          msGrip.startY -
          p.y
        ) / (height * 0.33),
        -1,
        1
      );

    const target =
      msClamp(
        msGrip.startAngle +
        travel *
        (
          travel >= 0
            ? 90
            : 85
        ),
        MS_MIN,
        MS_MAX
      );

    const origin =
      msCoordinates[
        msGrip.index
      ];

    for (
      let i = 0;
      i < MS_COUNT;
      i++
    ) {

      const d =
        Math.hypot(
          msCoordinates[i].x -
          origin.x,

          msCoordinates[i].y -
          origin.y
        );

      const weight =
        Math.exp(
          -1.7 * d * d
        );

      msTargets[i] =
        MS_NEUTRAL +
        (
          target -
          MS_NEUTRAL
        ) * weight;
    }

    msMode =
      "LOCAL PULL";

    return;
  }

  // ===================================================
  // RELEASE TO NEUTRAL
  // ===================================================

  msGrip = null;

  msTargets.fill(
    MS_NEUTRAL
  );

  msMode = "RELEASE";
}

// =====================================================
// LUMINOUS HAND TRAILS
// FOLLOW INDEX FINGERTIPS
// =====================================================

function msDrawTrails() {

  const now =
    millis();

  const detected = hands
    .map(h => msCenter(h))
    .filter(Boolean);

  for (
    let i = 0;
    i < 2;
    i++
  ) {

    if (
      i < detected.length
    ) {

      const p =
        detected[i];

      const old =
        msTrails[i].length
          ? msTrails[i][
              msTrails[i].length - 1
            ]
          : null;

      const down =
        old &&
        p.y - old.y > 1.5;

      const cool =
        msMode === "VALLEY" ||
        (
          msMode === "LOCAL PULL" &&
          msTargets.some(
            v => v < 85
          )
        ) ||
        down;

      msTrails[i].push({

        x: p.x,
        y: p.y,
        time: now,
        cool: !!cool

      });
    }

    msTrails[i] =
      msTrails[i].filter(
        p =>
          now - p.time < 900
      );

    const trail =
      msTrails[i];

    for (
      let j = 1;
      j < trail.length;
      j++
    ) {

      const a =
        trail[j - 1];

      const b =
        trail[j];

      const fade =
        msClamp(
          1 -
          (
            now - b.time
          ) / 900,
          0,
          1
        );

      const palette =
        b.cool
          ? [
              [69, 107, 255],
              [0, 169, 255],
              [56, 228, 245],
              [140, 255, 226]
            ]
          : [
              [255, 55, 95],
              [255, 102, 184],
              [255, 153, 77],
              [255, 230, 109]
            ];

      const rgb =
        palette[
          Math.floor(j / 5) % 4
        ];

      // OUTER GLOW
      stroke(
        rgb[0],
        rgb[1],
        rgb[2],
        fade * 40
      );

      strokeWeight(24);

      line(
        a.x,
        a.y,
        b.x,
        b.y
      );

      // COLOURED TRAIL
      stroke(
        rgb[0],
        rgb[1],
        rgb[2],
        fade * 110
      );

      strokeWeight(9);

      line(
        a.x,
        a.y,
        b.x,
        b.y
      );

      // BRIGHT CENTRE
      stroke(
        255,
        245,
        240,
        fade * 220
      );

      strokeWeight(2);

      line(
        a.x,
        a.y,
        b.x,
        b.y
      );
    }

    // FINGERTIP GLOW
    if (
      i < detected.length
    ) {

      const p =
        detected[i];

      noStroke();

      fill(
        255,
        255,
        255,
        160
      );

      circle(
        p.x,
        p.y,
        9
      );
    }
  }
}

// =====================================================
// 36-UNIT CONFIGURATION MAP
// =====================================================

function msDrawGrid() {

  const diameter =
    Math.min(
      width / 14,
      height / 10,
      44
    );

  const gap =
    diameter * 1.16;

  const left =
    width / 2 -
    2.7 * gap;

  const top =
    height / 2 -
    2.5 * gap;

  textAlign(
    CENTER,
    CENTER
  );

  for (
    let row = 0;
    row < 6;
    row++
  ) {

    for (
      let col = 0;
      col < 6;
      col++
    ) {

      const x =
        left +
        col * gap +
        (
          row % 2
            ? gap * 0.4
            : 0
        );

      const y =
        top +
        row * gap;

      const active =
        row >= 1 &&
        row <= 4 &&
        col >= 1 &&
        col <= 4;

      strokeWeight(1);

      stroke(
        active
          ? color(
              85,
              205,
              210,
              170
            )
          : color(
              130,
              130,
              130,
              90
            )
      );

      fill(
        active
          ? color(
              8,
              70,
              78,
              130
            )
          : color(
              115,
              115,
              115,
              75
            )
      );

      circle(
        x,
        y,
        diameter
      );

      if (active) {

        const number =
          (
            row - 1
          ) * 4 + col;

        noStroke();
        fill(245);

        textSize(
          Math.max(
            11,
            diameter * 0.33
          )
        );

        text(
          number,
          x,
          y -
          diameter * 0.15
        );

        textSize(
          Math.max(
            8,
            diameter * 0.22
          )
        );

        text(
          Math.round(
            msCurrent[
              number - 1
            ]
          ) + "°",
          x,
          y +
          diameter * 0.19
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

  // ===================================================
  // TEMPORARY MIRRORED SELFIE CAMERA PREVIEW
  // SAME METHOD AS EXPERIMENT 1E
  // ===================================================

  if (
    video &&
    video.elt &&
    video.elt.readyState >= 2
  ) {

    push();

    translate(
      width,
      0
    );

    scale(
      -1,
      1
    );

    image(
      video,
      0,
      0,
      width,
      height
    );

    pop();
  }

  // ===================================================
  // UPDATE GESTURES
  // ===================================================

  msUpdateGesture();

  // ===================================================
  // UPDATE SERVO ANGLES
  // ===================================================

  const ease =
    msMode === "RELEASE"
      ? 0.13
      : 0.28;

  for (
    let i = 0;
    i < MS_COUNT;
    i++
  ) {

    msCurrent[i] +=
      (
        msTargets[i] -
        msCurrent[i]
      ) * ease;
  }

  // ===================================================
  // DRAW VISUALS
  // ===================================================

  msDrawTrails();
  msDrawGrid();

  noStroke();
  fill(245);

  textAlign(
    CENTER,
    CENTER
  );

  textSize(15);

  text(
    msMode,
    width / 2,
    45
  );

  // ===================================================
  // SEND SERVO ANGLES VIA BLE
  // ===================================================

  const now =
    millis();

  if (
    bleConnected &&
    now - msLastSend >= 100
  ) {

    const channels =
      Array(16).fill(
        MS_NEUTRAL
      );

    for (
      let i = 0;
      i < MS_COUNT;
      i++
    ) {

      channels[
        msChannelForServo[i]
      ] =
        Math.round(
          msCurrent[i]
        );
    }

    sendAngles(
      channels
    );

    msLastSend =
      now;
  }
}

// =====================================================
// WINDOW RESIZE
// =====================================================

function windowResized() {

  resizeCanvas(
    windowWidth,
    windowHeight
  );
}
