#include "PluginEditor.h"

MohitsEditor::MohitsEditor (MohitsProcessor& processor)
    : AudioProcessorEditor (processor)
{
    message.setText ("MOHITS PRO 1\n\nAudio passes through for now.\nThe DSP and the web UI are added in the next steps.",
                     juce::dontSendNotification);
    message.setJustificationType (juce::Justification::centred);
    message.setFont (juce::Font (16.0f));
    addAndMakeVisible (message);

    setSize (900, 320);
    setResizable (false, false);
}

void MohitsEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff191c21));
}

void MohitsEditor::resized()
{
    message.setBounds (getLocalBounds().reduced (24));
}
