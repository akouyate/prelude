"use client";

import * as React from "react";

let sharedAudioContext: AudioContext | null = null;

export function prepareVoiceLevelMeter() {
  const audioContext = voiceLevelAudioContext();
  void audioContext?.resume().catch(() => undefined);
}

export function VoiceLevelMeter({
  isActive,
  stream,
}: {
  isActive: boolean;
  stream: MediaStream | null;
}) {
  const barRefs = React.useRef<Array<HTMLSpanElement | null>>([]);

  React.useEffect(() => {
    const audioTrack = stream
      ?.getAudioTracks()
      .find((track) => track.readyState === "live");
    if (!audioTrack || !isActive) {
      setVoiceBars(barRefs.current, 0);
      return undefined;
    }

    const audioContext = voiceLevelAudioContext();
    if (!audioContext) {
      setVoiceBars(barRefs.current, 0);
      return undefined;
    }

    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(
      new MediaStream([audioTrack]),
    );
    let animationFrame = 0;

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    const timeDomainData = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser);
    void audioContext.resume().catch(() => undefined);

    const renderLevel = () => {
      analyser.getByteTimeDomainData(timeDomainData);
      setVoiceBars(barRefs.current, voiceLevel(timeDomainData));
      animationFrame = window.requestAnimationFrame(renderLevel);
    };

    renderLevel();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      source.disconnect();
      analyser.disconnect();
      setVoiceBars(barRefs.current, 0);
    };
  }, [isActive, stream]);

  return (
    <div aria-hidden="true" className="flex h-[26px] items-end gap-1 px-2.5">
      {[0, 1, 2, 3, 4].map((bar) => (
        <span
          className="h-full w-1 origin-bottom rounded-[99px] bg-spruce-400 transition-transform duration-75"
          data-voice-level-bar="true"
          key={bar}
          ref={(element) => {
            barRefs.current[bar] = element;
          }}
          style={{ transform: "scaleY(0.28)" }}
        />
      ))}
    </div>
  );
}

function voiceLevelAudioContext() {
  if (typeof window === "undefined") {
    return null;
  }

  if (sharedAudioContext && sharedAudioContext.state !== "closed") {
    return sharedAudioContext;
  }

  const AudioContextConstructor =
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }

  sharedAudioContext = new AudioContextConstructor();
  return sharedAudioContext;
}

function voiceLevel(timeDomainData: Uint8Array) {
  let sum = 0;

  for (const sample of timeDomainData) {
    const centeredSample = (sample - 128) / 128;
    sum += centeredSample * centeredSample;
  }

  return Math.min(1, Math.sqrt(sum / timeDomainData.length) * 5.2);
}

// Bars are full-height and scaled from the bottom, between the design's resting
// 0.28 and 1. Brightness is owned by the meter's container (dimmed unless it is
// the candidate's turn), so the bars themselves stay at full opacity.
const restingBarScale = 0.28;

function setVoiceBars(bars: Array<HTMLSpanElement | null>, level: number) {
  const shapedLevel = Math.pow(level, 0.72);
  const barMultipliers = [0.45, 0.75, 1, 0.82, 0.55];

  bars.forEach((bar, index) => {
    if (!bar) {
      return;
    }

    const peak = shapedLevel * (barMultipliers[index] ?? 1);
    const scale = restingBarScale + peak * (1 - restingBarScale);
    bar.style.transform = `scaleY(${scale.toFixed(3)})`;
  });
}
