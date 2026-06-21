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
    <div aria-hidden="true" className="flex h-7 items-end gap-1 px-3">
      {[0, 1, 2, 3, 4].map((bar) => (
        <span
          className="w-1 rounded-full bg-olive-200 opacity-45 transition-[height,opacity] duration-75"
          data-voice-level-bar="true"
          key={bar}
          ref={(element) => {
            barRefs.current[bar] = element;
          }}
          style={{ height: "4px" }}
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

function setVoiceBars(bars: Array<HTMLSpanElement | null>, level: number) {
  const shapedLevel = Math.pow(level, 0.72);
  const barMultipliers = [0.45, 0.75, 1, 0.82, 0.55];

  bars.forEach((bar, index) => {
    if (!bar) {
      return;
    }

    const nextHeight = 4 + shapedLevel * 22 * (barMultipliers[index] ?? 1);
    bar.style.height = `${Math.round(nextHeight)}px`;
    bar.style.opacity = `${0.45 + shapedLevel * 0.55}`;
  });
}
