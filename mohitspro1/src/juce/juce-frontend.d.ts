// Types for the vendored JUCE frontend (juce-frontend.js).

export interface JuceSliderState {
  readonly name: string;
  getNormalisedValue(): number;
  setNormalisedValue(newValue: number): void;
  sliderDragStarted(): void;
  sliderDragEnded(): void;
  valueChangedEvent: { addListener(fn: () => void): void; removeListener?(fn: () => void): void };
}

/** Returns the slider state for a parameter. Only works inside a JUCE WebView. */
export function getSliderState(name: string): JuceSliderState;
