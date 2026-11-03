cmake_minimum_required(VERSION 3.22)
project(MusicEnginePlugin VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE is fetched at configure time. Pin the tag; verify it exists before first build.
include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.4
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

# AU is macOS-only; VST3 and Standalone build everywhere.
if(APPLE)
    set(MUSIC_ENGINE_FORMATS VST3 AU Standalone)
else()
    set(MUSIC_ENGINE_FORMATS VST3 Standalone)
endif()

juce_add_plugin(MusicEnginePlugin
    COMPANY_NAME                 "moolaiam"
    PLUGIN_MANUFACTURER_CODE     Mlai
    PLUGIN_CODE                  Mgen
    FORMATS                      ${MUSIC_ENGINE_FORMATS}
    PRODUCT_NAME                 "Music Engine"
    IS_SYNTH                     TRUE
    NEEDS_MIDI_INPUT             TRUE
    NEEDS_MIDI_OUTPUT            FALSE
    IS_MIDI_EFFECT               FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS  TRUE
    COPY_PLUGIN_AFTER_BUILD      FALSE
    PLUGIN_NAME                  "Music Engine")

target_sources(MusicEnginePlugin PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/EngineClient.cpp)

target_compile_definitions(MusicEnginePlugin PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_LOAD_CURL_SYMBOLS_LAZILY=1   # Linux only: load libcurl at runtime, no link-time dependency
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(MusicEnginePlugin PRIVATE
    juce::juce_audio_basics
    juce::juce_audio_formats
    juce::juce_audio_plugin_client
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_core
    juce::juce_events
    juce::juce_data_structures
    juce::juce_gui_basics
    juce::juce_gui_extra
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags)

# Headless tests: `cmake -DMUSIC_ENGINE_BUILD_TESTS=ON ...`, then run MusicEngineTests [mock-url].
option(MUSIC_ENGINE_BUILD_TESTS "Build the headless test app" OFF)
if(MUSIC_ENGINE_BUILD_TESTS)
    juce_add_console_app(MusicEngineTests)
    target_sources(MusicEngineTests PRIVATE
        tests/PluginTests.cpp
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
        Source/EngineClient.cpp)
    target_compile_definitions(MusicEngineTests PUBLIC
        JUCE_WEB_BROWSER=0 JUCE_DISPLAY_SPLASH_SCREEN=0 JUCE_LOAD_CURL_SYMBOLS_LAZILY=1
        JUCE_MODAL_LOOPS_PERMITTED=1)   # test harness pumps messages while waiting
    target_link_libraries(MusicEngineTests PRIVATE
        juce::juce_audio_basics juce::juce_audio_formats juce::juce_audio_processors
        juce::juce_audio_utils juce::juce_core juce::juce_data_structures
        juce::juce_events juce::juce_gui_basics juce::juce_gui_extra
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
endif()
