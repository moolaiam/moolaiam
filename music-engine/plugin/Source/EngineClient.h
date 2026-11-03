#pragma once

#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>

// Background job: POST a generation, poll until it finishes, download the WAV, decode it.
// Every callback runs on the message thread and is posted with MessageManager::callAsync.
// Callers must hold their callbacks through juce::Component::SafePointer, because a result
// can arrive after the editor has closed.
class EngineClient : private juce::Thread
{
public:
    struct Request
    {
        juce::String baseUrl;
        juce::String apiKey;          // read from MUSICENGINE_API_KEY, never stored in the project
        juce::String prompt;
        double durationSeconds = 30.0;
        bool instrumental = true;
        int seed = -1;                // < 0 = let the server choose
    };

    struct Outcome
    {
        bool ok = false;
        juce::String error;
        juce::AudioBuffer<float> audio;
        double sampleRate = 44100.0;
    };

    using StatusFn = std::function<void(juce::String status, float progress)>;
    using DoneFn = std::function<void(Outcome)>;

    EngineClient();
    ~EngineClient() override;

    void start(Request request, StatusFn onStatus, DoneFn onDone);
    void cancel();
    bool isBusy() const { return isThreadRunning(); }

    // Reads MUSICENGINE_API_KEY from the environment.
    static juce::String apiKeyFromEnvironment();

private:
    void run() override;

    Request request;
    StatusFn onStatus;
    DoneFn onDone;
    juce::String jobId;
    juce::CriticalSection jobLock;

    bool postGeneration(juce::String& errorOut);
    bool pollUntilDone(juce::String& statusOut, juce::String& errorOut);
    bool downloadAudio(Outcome& out);
    juce::var getJson(const juce::String& path, int& httpStatus, juce::String& errorOut) const;
    void report(juce::String status, float progress);
    void finish(Outcome outcome);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(EngineClient)
};
