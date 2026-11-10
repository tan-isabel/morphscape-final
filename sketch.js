
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

    positions = detected.slice(0, 2)
      .map(h => h.fingertip);

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

  // Offscreen canvas for smooth, blurred glow
  if (
    !msDrawTrails.glowCanvas ||
    msDrawTrails.glowCanvas.width !== width ||
    msDrawTrails.glowCanvas.height !== height
  ) {

    msDrawTrails.glowCanvas =
      document.createElement("canvas");

    msDrawTrails.glowCanvas.width = width;
    msDrawTrails.glowCanvas.height = height;
  }

  const glowCanvas = msDrawTrails.glowCanvas;
  const ctx = glowCanvas.getContext("2d");

  ctx.clearRect(0, 0, width, height);

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

      if (
        !old ||
        jump < Math.max(width, height) * 0.22
      ) {

        const down = old && p.y - old.y > 1.5;

        const cool =
          msMode === "VALLEY" ||
          (
            msMode === "LOCAL PULL" &&
            msTargets.some(v => v < 85)
          ) ||
          down;

        msTrails[i].push({
          x: p.x,
          y: p.y,
          time: now,
          cool: !!cool
        });

        msTrailPositions[i] = p;
      }
    }

    msTrails[i] = msTrails[i].filter(
      pt => now - pt.time < 1000
    );

    const trail = msTrails[i];

    // Draw overlapping radial gradients
    // rather than sharp lines.
    for (let j = 0; j < trail.length; j++) {

      const pt = trail[j];

      const age = now - pt.time;
      const fade = msClamp(1 - age / 1000, 0, 1);

      const radius = Math.min(
        width * 0.13,
        height * 0.23,
        145
      );

      const palette = pt.cool
        ? [
            [0, 229, 245],
            [52, 164, 255],
            [157, 128, 255],
            [211, 174, 255]
          ]
        : [
            [255, 76, 124],
            [255, 119, 181],
            [255, 166, 95],
            [255, 223, 112]
          ];

      const rgb =
        palette[Math.floor(j / 4) % palette.length];

      const gradient = ctx.createRadialGradient(
        pt.x, pt.y, 0,
        pt.x, pt.y, radius
      );

      gradient.addColorStop(
        0,
        `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.10 * fade})`
      );

      gradient.addColorStop(
        0.35,
        `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.07 * fade})`
      );

      gradient.addColorStop(
        0.7,
        `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.025 * fade})`
      );

      gradient.addColorStop(
        1,
        `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`
      );

      ctx.fillStyle = gradient;

      ctx.beginPath();
      ctx.arc(
        pt.x,
        pt.y,
        radius,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  // Render the completed glow over the camera/grid
  drawingContext.drawImage(glowCanvas, 0, 0);
}
