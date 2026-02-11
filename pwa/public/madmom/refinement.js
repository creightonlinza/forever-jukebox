export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function buildEnergy(activations) {
  const beat = Array.isArray(activations?.beat) ? activations.beat : [];
  const downbeat = Array.isArray(activations?.downbeat) ? activations.downbeat : [];
  const count = Math.max(beat.length, downbeat.length);
  const energy = new Array(count);
  for (let i = 0; i < count; i += 1) {
    energy[i] = (beat[i] ?? 0) + (downbeat[i] ?? 0);
  }
  return energy;
}

export function refineEventTimes(events, energy, fps) {
  if (!Array.isArray(events) || events.length === 0 || energy.length === 0 || !fps) {
    return Array.isArray(events) ? events : [];
  }

  let minEnergy = energy[0];
  let maxEnergy = energy[0];
  for (let i = 1; i < energy.length; i += 1) {
    if (energy[i] < minEnergy) minEnergy = energy[i];
    if (energy[i] > maxEnergy) maxEnergy = energy[i];
  }
  const range = maxEnergy - minEnergy;

  return events.map((event) => {
    const timeSec = Number(event?.time_sec) || 0;
    const nearest = clamp(Math.round(timeSec * fps), 0, energy.length - 1);

    let peak = nearest;
    if (nearest > 0 && nearest < energy.length - 1) {
      const left = nearest - 1;
      const right = nearest + 1;
      const midVal = energy[nearest];
      if (energy[left] > midVal && energy[left] >= energy[right]) {
        peak = left;
      } else if (energy[right] > midVal && energy[right] > energy[left]) {
        peak = right;
      }
    }

    let refinedFrame = peak;
    if (peak > 0 && peak < energy.length - 1) {
      const y1 = energy[peak - 1];
      const y2 = energy[peak];
      const y3 = energy[peak + 1];
      const denom = y1 - 2 * y2 + y3;
      if (Math.abs(denom) >= 1e-12) {
        const delta = clamp(0.5 * (y1 - y3) / denom, -0.5, 0.5);
        refinedFrame = peak + delta;
      }
    }

    const confidence = range < 1e-6 ? 0.5 : clamp((energy[peak] - minEnergy) / range, 0, 1);
    return {
      ...event,
      time_sec: refinedFrame / fps,
      confidence,
    };
  });
}

export function buildBeatEvents(beats, downbeats, fps) {
  const tol = 1 / fps + 1e-6;
  let beatNumber = 1;
  let downbeatIdx = 0;
  return beats.map((beat) => {
    if (
      downbeatIdx < downbeats.length &&
      Math.abs(beat.time_sec - downbeats[downbeatIdx].time_sec) <= tol
    ) {
      beatNumber = 1;
      downbeatIdx += 1;
    }
    const out = [beat.time_sec, beatNumber, beat.confidence];
    beatNumber += 1;
    return out;
  });
}
