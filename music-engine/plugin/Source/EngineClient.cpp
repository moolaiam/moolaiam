#include "EngineClient.h"

namespace
{
constexpr int connectTimeoutMs = 10000;
constexpr int pollIntervalMs = 1000;
constexpr int maxPollSeconds = 900;   // 15 minutes; long songs can take a while

juce::String authHeader(const juce::String& apiKey)
{
    return apiKey.isEmpty() ? juce::String() : ("Authorization: Bearer " + apiKey + "\n");
}

// JUCE chooses GET or POST from the parameter-handling mode, not from the request command.
// A POST must use inPostData; a custom command on an inAddress request sends no body.
juce::URL::InputStreamOptions postOptions(const juce::String& headers)
{
    return juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inPostData)
        .withExtraHeaders(headers)
        .withConnectionTimeoutMs(connectTimeoutMs);
}

juce::URL::InputStreamOptions getOptions(const juce::String& headers)
{
    return juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
        .withExtraHeaders(headers)
        .withConnectionTimeoutMs(connectTimeoutMs);
}
}

EngineClient::EngineClient() : juce::Thread("MusicEngineClient") {}

EngineClient::~EngineClient()
{
    stopThread(5000);
}

juce::String EngineClient::apiKeyFromEnvironment()
{
    return juce::SystemStats::getEnvironmentVariable("MUSICENGINE_API_KEY", {});
}

void EngineClient::start(Request req, StatusFn status, DoneFn done)
{
    stopThread(5000);
    {
        const juce::ScopedLock sl(jobLock);
        request = std::move(req);
        onStatus = std::move(status);
        onDone = std::move(done);
        jobId.clear();
    }
    startThread();
}

void EngineClient::cancel()
{
    signalThreadShouldExit();
}

void EngineClient::report(juce::String status, float progress)
{
    StatusFn fn;
    {
        const juce::ScopedLock sl(jobLock);
        fn = onStatus;
    }
    if (fn)
        juce::MessageManager::callAsync([fn, status, progress] { fn(status, progress); });
}

void EngineClient::finish(Outcome outcome)
{
    DoneFn fn;
    {
        const juce::ScopedLock sl(jobLock);
        fn = onDone;
    }
    if (fn)
        juce::MessageManager::callAsync([fn, outcome]() mutable { fn(std::move(outcome)); });
}

juce::var EngineClient::getJson(const juce::String& path, int& httpStatus, juce::String& errorOut) const
{
    juce::URL url(request.baseUrl + path);
    const auto opts = getOptions(authHeader(request.apiKey)).withStatusCode(&httpStatus);
    auto stream = url.createInputStream(opts);
    if (stream == nullptr)
    {
        errorOut = "Could not reach the generation server at " + request.baseUrl;
        return {};
    }
    return juce::JSON::parse(stream->readEntireStreamAsString());
}

bool EngineClient::postGeneration(juce::String& errorOut)
{
    auto* body = new juce::DynamicObject();
    body->setProperty("prompt", request.prompt);
    body->setProperty("duration_seconds", request.durationSeconds);
    body->setProperty("instrumental", request.instrumental);
    if (request.seed >= 0)
        body->setProperty("seed", static_cast<juce::int64>(request.seed));
    const auto payload = juce::JSON::toString(juce::var(body));

    juce::URL url = juce::URL(request.baseUrl + "/v1/generations").withPOSTData(payload);
    int status = 0;
    const auto opts = postOptions("Content-Type: application/json\n" + authHeader(request.apiKey))
                          .withStatusCode(&status);
    auto stream = url.createInputStream(opts);
    if (stream == nullptr)
    {
        errorOut = "Could not reach the generation server at " + request.baseUrl;
        return false;
    }
    const auto response = juce::JSON::parse(stream->readEntireStreamAsString());
    if (status != 202)
    {
        errorOut = "Server rejected the request (HTTP " + juce::String(status) + "): "
                   + response.getProperty("message", "no details").toString();
        return false;
    }
    const juce::ScopedLock sl(jobLock);
    jobId = response.getProperty("id", "").toString();
    return jobId.isNotEmpty();
}

bool EngineClient::pollUntilDone(juce::String& statusOut, juce::String& errorOut)
{
    const auto started = juce::Time::getMillisecondCounter();
    while (!threadShouldExit())
    {
        int status = 0;
        const auto job = getJson("/v1/generations/" + jobId, status, errorOut);
        if (status != 200)
        {
            if (errorOut.isEmpty())
                errorOut = "Status check failed (HTTP " + juce::String(status) + ")";
            return false;
        }
        statusOut = job.getProperty("status", "").toString();
        const auto progress = static_cast<float>(job.getProperty("progress", 0.0).toString().getDoubleValue());
        report(statusOut, progress);

        if (statusOut == "succeeded")
            return true;
        if (statusOut == "failed")
        {
            errorOut = job.getProperty("error", "generation failed").toString();
            return false;
        }
        if (statusOut == "cancelled")
        {
            errorOut = "Cancelled";
            return false;
        }
        if (juce::Time::getMillisecondCounter() - started > static_cast<juce::uint32>(maxPollSeconds) * 1000u)
        {
            errorOut = "Timed out waiting for the server";
            return false;
        }
        wait(pollIntervalMs);
    }

    // The user cancelled: tell the server so it stops spending compute. Best effort.
    juce::URL url = juce::URL(request.baseUrl + "/v1/generations/" + jobId + "/cancel").withPOSTData(juce::String());
    if (auto s = url.createInputStream(postOptions(authHeader(request.apiKey)))) { (void) s; }
    errorOut = "Cancelled";
    return false;
}

bool EngineClient::downloadAudio(Outcome& out)
{
    juce::URL url(request.baseUrl + "/v1/generations/" + jobId + "/audio");
    auto stream = url.createInputStream(getOptions(authHeader(request.apiKey)));
    if (stream == nullptr)
    {
        out.error = "Could not download the rendered audio";
        return false;
    }
    juce::MemoryBlock bytes;
    stream->readIntoMemoryBlock(bytes);

    juce::WavAudioFormat wav;
    // createReaderFor takes ownership of the raw stream, and deletes it on failure.
    auto reader = wav.createReaderFor(new juce::MemoryInputStream(bytes, true), true);
    if (reader == nullptr)
    {
        out.error = "Downloaded audio is not a readable WAV file";
        return false;
    }
    const auto length = static_cast<int>(reader->lengthInSamples);
    out.audio.setSize(static_cast<int>(reader->numChannels), length);
    reader->read(&out.audio, 0, length, 0, true, reader->numChannels > 1);
    out.sampleRate = reader->sampleRate;
    return true;
}

void EngineClient::run()
{
    Outcome outcome;
    juce::String error;
    juce::String status;

    if (!postGeneration(error)
        || !pollUntilDone(status, error)
        || !downloadAudio(outcome))
    {
        outcome.ok = false;
        outcome.error = error.isNotEmpty() ? error : outcome.error;
        if (outcome.error.isEmpty())
            outcome.error = "Unknown error";
    }
    else
    {
        outcome.ok = true;
    }
    finish(std::move(outcome));
}
