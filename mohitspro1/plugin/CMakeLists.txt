cmake_minimum_required(VERSION 3.22)
project(MohitsPro1 VERSION 1.0.0 LANGUAGES C CXX)

# JUCE is downloaded at configure time, so no Projucer is needed.
# Pin the version so every build matches.
include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        7.0.12
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Settings taken from the Projucer screens.
juce_add_plugin(MohitsPro1
    COMPANY_NAME                "Mohits Production"
    BUNDLE_ID                   "com.Moola.MohitsPro1"
    PRODUCT_NAME                "MOHITS PRO 1"
    PLUGIN_MANUFACTURER_CODE    Mohi
    PLUGIN_CODE                 MO1h
    FORMATS                     Standalone VST3 AU
    IS_SYNTH                    FALSE
    NEEDS_MIDI_INPUT            FALSE
    NEEDS_MIDI_OUTPUT           FALSE
    IS_MIDI_EFFECT              FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD     FALSE
    VST3_CATEGORIES             Fx
    AU_MAIN_TYPE                kAudioUnitType_Effect
    NEEDS_WEB_BROWSER           TRUE
)

juce_generate_juce_header(MohitsPro1)

target_sources(MohitsPro1 PRIVATE
    Source/ParameterLayout.cpp
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
)

target_compile_definitions(MohitsPro1 PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(MohitsPro1 PRIVATE
    juce::juce_audio_utils
    juce::juce_gui_extra
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)
