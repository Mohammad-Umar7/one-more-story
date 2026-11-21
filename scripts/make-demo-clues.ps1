# Regenerates the four demo clue recordings in seed/audio with the Windows
# speech engine (stand-ins for the player's own voice; families replace them
# by recording real clues in Family setup). Requires ffmpeg on PATH.
#   powershell -ExecutionPolicy Bypass -File scripts/make-demo-clues.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "seed\audio"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "oms-clues"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$clues = [ordered]@{
  "clue-glasses" = "I always put my glasses down with the fruit, in the blue one."
  "clue-keys"    = "My keys hang up by the door, so I never forget them."
  "clue-wallet"  = "My wallet goes in the drawer. The top one."
  "clue-beads"   = "My beads stay by the window, near the little plant."
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft David Desktop")
$synth.Rate = -2
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($name in $clues.Keys) {
  $wav = Join-Path $tmp "$name.wav"
  $synth.SetOutputToWaveFile($wav, $format)
  $synth.Speak($clues[$name])
  $synth.SetOutputToNull()
  $mp3 = Join-Path $out "$name.mp3"
  # Slightly lower and slower, softened, with a little room tone.
  & ffmpeg -y -loglevel error -i $wav -af "asetrate=22050*0.92,aresample=44100,lowpass=f=6500,aecho=0.8:0.4:18:0.12,apad=pad_dur=0.25" -ac 1 -b:a 64k $mp3
  Write-Output "wrote $mp3"
}
$synth.Dispose()
