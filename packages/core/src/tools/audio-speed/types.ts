export interface AudioSpeedParams {
  /** Playback-speed multiplier from 0.25 to 4. Default 1.5. */
  speed: number;
  /** Preserve the original pitch while changing speed. Default true. */
  preservePitch: boolean;
}

export const defaultAudioSpeedParams: AudioSpeedParams = {
  speed: 1.5,
  preservePitch: true,
};
