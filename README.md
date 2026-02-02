# VeloRead

VeloRead is a mobile speed-reading app built with Expo + React Native.
It uses RSVP-style playback (one token at a time), optional ORP highlighting,
and punctuation-aware pacing to help you read faster while staying in flow.

## Features

- Import plain text (`.txt`) books from your device.
- Import EPUB (`.epub`) books (text extraction from chapter documents).
- Keep EPUB chapter boundaries and jump chapter-to-chapter in reader.
- Load a built-in sample text to test the reader quickly.
- Tune reading speed from 120 to 900 WPM.
- Toggle ORP highlight and punctuation pauses.
- Resume where you stopped, with reading progress persisted locally.
- Jump quickly through text (`-10`, `+10`, tap zones, and progress slider).

## Current format support

- Supported: `.txt`, `.epub`

## Tech stack

- Expo SDK 54
- React Native 0.81
- Expo Router (file-based routing)
- AsyncStorage for local persistence

## Getting started

### Prerequisites

- Node.js 18+ (recommended)
- npm
- Expo-compatible simulator/device (Expo Go, iOS Simulator, or Android Emulator)

### Install and run

```bash
npm install
npm run start
```

Then choose a target from the Expo CLI output.

## Useful scripts

```bash
npm run start    # Start Metro / Expo dev server
npm run android  # Open Android target
npm run ios      # Open iOS target
npm run web      # Run web target
npm run lint     # Run lint checks
```

## Reading flow

1. Open the library screen.
2. Tap **Load Sample** or **Import Book**.
3. Open a book and configure WPM + reading options.
4. Start reading in the RSVP reader and adjust controls live.

## Project structure

```text
app/
  index.tsx              # Library screen route
  setup/[bookId].tsx     # Reader setup route
  reader/[bookId].tsx    # Reader route
src/
  screens/               # Main screen implementations
  parsing/               # Tokenization and read-time estimates
  reader/                # Playback timing logic
  storage/               # AsyncStorage data access
  utils/                 # Import and formatting helpers
```

## Notes

- Data is stored locally on device via AsyncStorage.
- Large books are saved in token chunks for better runtime performance.

## Legal and compliance

- License: `LICENSE`
- Privacy Policy: `docs/compliance/PRIVACY_POLICY.md`
- Terms of Use: `docs/compliance/TERMS_OF_USE.md`
- Store submission draft answers: `docs/compliance/STORE_PRIVACY_DISCLOSURE.md`
