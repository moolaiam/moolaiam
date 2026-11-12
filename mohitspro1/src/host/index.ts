import { createHost, type Host } from './host';
import { createMemoryTransport } from './memory';
import { createJuceTransport, hasJuceBackend } from './juce';

/** Picks the JUCE transport when the WebView provides one, otherwise the in-memory preview. */
export function createDefaultHost(): Host {
  const transport = hasJuceBackend() ? createJuceTransport() : createMemoryTransport();
  return createHost(transport);
}
