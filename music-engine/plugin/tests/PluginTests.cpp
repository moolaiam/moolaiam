// Headless tests for the plug-in: audio playback logic and the server client.
//
// Usage: MusicEngineTests [mock-server-base-url]
// With a URL, the client test runs against tests/mock_server.py. Without one, that test is skipped.

#include <juce_events/juce_events.h>
#include "../Source/EngineClient.h"
#include "../Source/PluginProcessor.h"

namespace
{
juce::AudioBuffer<float> sineClip(int samples, float amp = 0.5f)
{
    juce::AudioBuffer<float> b(2, samples);
    for (int ch = 0; ch < 2; ++ch)
        for (int i = 0; i < samples; ++i)
            b.setSample(ch, i, amp);  // constant DC so output level is easy to check
    return b;
}

// Run one block of audio through the processor, optionally with a note-on at sample 0.
juce::AudioBuffer<float> renderBlock(MusicEngineProcessor& p, int numSamples, bool noteOn)
{
    juce::AudioBuffer<float> buffer(2, numSamples);
    buffer.clear();
    juce::MidiBuffer midi;
    if (noteOn)
        midi.addEvent(juce::MidiMessage::noteOn(1, 60, 0.8f), 0);
    p.processBlock(buffer, midi);
    return buffer;
}

float peak(const juce::AudioBuffer<float>& b)
{
    return b.getMagnitude(0, b.getNumSamples());
}
}

class ProcessorTests : public juce::UnitTest
{
public:
    ProcessorTests() : juce::UnitTest("Processor playback", "MusicEngine") {}

    void runTest() override
    {
        beginTest("silent with no clip");
        {
            MusicEngineProcessor p;
            p.prepareToPlay(44100.0, 512);
            auto out = renderBlock(p, 512, true);
            expectEquals(peak(out), 0.0f);
        }

        beginTest("silent until play is requested");
        {
            MusicEngineProcessor p;
            p.prepareToPlay(44100.0, 512);
            p.setClip(sineClip(44100), 44100.0);
            expectEquals(peak(renderBlock(p, 512, false)), 0.0f);
            p.play();
            expectWithinAbsoluteError(peak(renderBlock(p, 512, false)), 0.5f, 1e-4f);
        }

        beginTest("MIDI note-on starts playback");
        {
            MusicEngineProcessor p;
            p.prepareToPlay(44100.0, 512);
            p.setClip(sineClip(44100), 44100.0);
            expect(peak(renderBlock(p, 512, true)) > 0.4f, "note-on should start the clip");
            expect(p.isPlaying());
        }

        beginTest("stops at end of clip when not looping");
        {
            MusicEngineProcessor p;
            p.prepareToPlay(44100.0, 512);
            p.setClip(sineClip(1000), 44100.0);
            p.play();
            renderBlock(p, 2048, false);
            expect(!p.isPlaying(), "playback should stop after the clip ends");
            expectEquals(peak(renderBlock(p, 512, false)), 0.0f);
        }

        beginTest("loops when looping is enabled");
        {
            MusicEngineProcessor p;
            p.prepareToPlay(44100.0, 512);
            p.looping = true;
            p.setClip(sineClip(1000), 44100.0);
            p.play();
            renderBlock(p, 2048, false);
            expect(p.isPlaying(), "looping playback should keep running");
        }

        beginTest("resamples a 22.05 kHz clip into a 44.1 kHz host");
        {
            // A 1 s clip at half the host rate should last 2 s of host time.
            MusicEngineProcessor p;
            p.prepareToPlay(44100.0, 512);
            p.setClip(sineClip(22050), 22050.0);
            p.play();
            int blocks = 0;
            while (p.isPlaying() && blocks < 1000)
            {
                renderBlock(p, 512, false);
                ++blocks;
            }
            const double seconds = blocks * 512.0 / 44100.0;
            expectWithinAbsoluteError(seconds, 1.0, 0.05);
        }

        beginTest("state round-trips through save and load");
        {
            MusicEngineProcessor a;
            a.prompt = "warm jazz at dusk";
            a.apiBaseUrl = "http://example.test:9000";
            a.durationSeconds = 45.0;
            a.looping = true;
            juce::MemoryBlock state;
            a.getStateInformation(state);

            MusicEngineProcessor b;
            b.setStateInformation(state.getData(), (int) state.getSize());
            expectEquals(b.prompt, juce::String("warm jazz at dusk"));
            expectEquals(b.apiBaseUrl, juce::String("http://example.test:9000"));
            expectWithinAbsoluteError(b.durationSeconds, 45.0, 1e-9);
            expect(b.looping);
        }
    }
};

class ClientTests : public juce::UnitTest
{
public:
    explicit ClientTests(juce::String baseUrl)
        : juce::UnitTest("Server client", "MusicEngine"), url(std::move(baseUrl)) {}

    void runTest() override
    {
        beginTest("unreachable server reports an error");
        {
            auto outcome = runJob("http://127.0.0.1:9");  // port 9 (discard) is closed
            expect(!outcome.ok);
            expect(outcome.error.contains("Could not reach"), outcome.error);
        }

        if (url.isEmpty())
        {
            logMessage("skipping mock-server test: no base URL given");
            return;
        }

        beginTest("full job against mock server returns decoded audio");
        {
            auto outcome = runJob(url);
            expect(outcome.ok, outcome.error);
            if (outcome.ok)
            {
                expectEquals((int) outcome.audio.getNumChannels(), 2);
                expectWithinAbsoluteError(outcome.audio.getNumSamples() / outcome.sampleRate, 2.0, 0.01);
                expect(outcome.audio.getMagnitude(0, outcome.audio.getNumSamples()) > 0.1f);
            }
        }

        beginTest("server validation error is surfaced to the user");
        {
            EngineClient::Request req;
            req.baseUrl = url;
            req.prompt = "";  // the mock rejects an empty prompt with 400
            auto outcome = runJob(req);
            expect(!outcome.ok);
            expect(outcome.error.contains("HTTP 400"), outcome.error);
        }
    }

private:
    juce::String url;

    static EngineClient::Outcome runJob(const juce::String& baseUrl)
    {
        EngineClient::Request req;
        req.baseUrl = baseUrl;
        req.prompt = "test prompt";
        req.durationSeconds = 2.0;
        req.instrumental = true;
        req.seed = 3;
        return runJob(req);
    }

    static EngineClient::Outcome runJob(const EngineClient::Request& req)
    {
        EngineClient client;
        std::atomic<bool> done { false };
        EngineClient::Outcome result;
        client.start(req, [](juce::String, float) {},
                     [&](EngineClient::Outcome o) {
                         result = std::move(o);
                         done = true;
                     });
        const auto deadline = juce::Time::getMillisecondCounter() + 30000;
        while (!done && juce::Time::getMillisecondCounter() < deadline)
            juce::MessageManager::getInstance()->runDispatchLoopUntil(20);
        if (!done)
            result.error = "timed out waiting for the client";
        return result;
    }
};

int main(int argc, char* argv[])
{
    juce::ScopedJuceInitialiser_GUI init;   // message thread for callbacks
    const juce::String baseUrl = argc > 1 ? juce::String(argv[1]) : juce::String();

    ProcessorTests processorTests;
    ClientTests clientTests(baseUrl);
    juce::UnitTestRunner runner;
    runner.runTests({ &processorTests, &clientTests });

    int failures = 0;
    for (int i = 0; i < runner.getNumResults(); ++i)
        failures += runner.getResult(i)->failures;
    std::printf("%s (%d failures)\n", failures == 0 ? "PASS" : "FAIL", failures);
    return failures == 0 ? 0 : 1;
}
