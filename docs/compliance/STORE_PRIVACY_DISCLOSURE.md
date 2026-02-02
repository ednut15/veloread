# Store Privacy Disclosure Checklist

Last updated: February 2, 2026

Use this as a draft when completing privacy forms in App Store Connect and Google Play Console.

## App behavior snapshot (current)

- No user account system
- No developer backend
- No advertising SDK
- No tracking SDK
- No in-app analytics SDK
- No crash-reporting SDK
- Data is stored locally on device only

## Data handled by the app

- Document content imported by the user (`.txt`, `.epub`)
- Reading progress and preferences (WPM, ORP, punctuation settings)

## Suggested answers (verify before submission)

### Apple App Privacy

- Data used to track you: **No**
- Data linked to you (collected by this app): **No**
- Data not linked to you (collected by this app): **No**

### Google Play Data Safety

- Data collected by your app: **No** (developer-controlled collection)
- Data shared by your app: **No**
- Is all data encrypted in transit: **Not applicable** (no transmission by app backend)
- Can users request data deletion: **Not applicable** (no account/backend data; data is local and removable by uninstall or in-app deletion)

## Important notes

1. Platform providers (Apple/Google/device OS) may collect diagnostics under their own policies.
2. If you add analytics, crash reporting, auth, cloud sync, ads, subscriptions, or web APIs, update this file and store disclosures before release.
3. Host `docs/compliance/PRIVACY_POLICY.md` at a public URL for store submissions.
