# Sounds

## Game and music volume

The **Game volume** and **Music volume** sliders save with the profile, so each profile keeps its own levels and a replaced `config.cfg` can't reset TF2 to full volume. If you change the volume in TF2's own options, execs keeps the new levels after the game closes. A profile that has never had a volume set in execs uses whatever TF2 last saved.

## Hit and kill sounds

Each slot plays one of TF2's built-in effects, a [comfig.app](https://comfig.app/hits/) community upload, a GameBanana hit or kill sound, or your own file. Your own clips can be WAV, MP3 or Ogg Vorbis, up to 30 seconds; execs converts them to a format TF2 plays.

Custom hit and kill sounds play on Valve Casual: TF2 exempts these two file names from sv_pure.

- **Boost** (+6 or +12 dB) makes your own file louder, since TF2 caps hit sound volume at 100%. Built-in effects can't be boosted, and sounds from retired catalogs keep the boost they were saved with.
- **Pitch** at 10 and 150 damage: 100 is normal and lower is deeper. The pitch rises with damage when the 150-damage pitch is higher.
- **Repeat delay**: 0 plays a sound for every hit; miniguns get loud.
- **Preview volume** only affects previews in execs. TF2 plays each sound at its slot's volume.

Favorites are saved in execs itself, not in a profile.

## GameBanana hit and kill sounds

In **Mods → Browse → Sounds**, hit and kill sound uploads say **Use in Sounds**. That downloads the upload and lists every sound in it here; nothing is installed until you choose **Use**.

## Messages you may see

- **A sound file changed outside execs**: its saved name may no longer describe the audio. Pick both sounds again, or use **Remove sound files**.
- **Other packs also replace TF2's hit or kill sound**: TF2 may play theirs, depending on which pack loads first.
- **A sound from a retired catalog**: it still plays and stays in your profile; choosing another sound replaces it.

## Credits

comfig.app sounds are community uploads from the comfig.app hits library; each clip belongs to its creator.
