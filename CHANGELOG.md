# Changelog

All notable changes to the Simmer API are documented in this file.

## [Unreleased]

### Fixed

#### User_B Response Shape Consistency (Commit: d29aeff)
- **Issue**: POST `/api/moment` and PATCH `/api/moment` endpoints sometimes returned `user_b` as a bare ObjectId string instead of a full user object, causing inconsistent data shapes across the API.
- **Solution**: 
  - Updated `updateMoment()` endpoint to populate `user_b` and use `mapMomentForResponse()` before returning
  - Updated `createMoment()` endpoint to populate `user_b` and use `mapMomentForResponse()` before returning
  - Ensured `POST /api/user/meet` continues to use consistent response mapping
- **Impact**: All moment/date endpoints now guarantee `user_a` and `user_b` are returned as fat objects with fields: `_id`, `first_name`, `avatar_url`, `image_url`
- **Compatibility**: Frontend can now reliably reference user data without additional API calls; fix eliminates the need for workarounds like `personNameMap` fallbacks

#### Dependency Deduplication
- **Issue**: @xenova/transformers bundles old sharp v8.14.5, but project uses sharp v0.34.4; both versions loaded at runtime, causing namespace collision warnings
- **Solution**:
  - Added pnpm overrides to force all dependencies to use sharp v0.34.4
  - Added postinstall script to remove nested sharp installations: `rm -rf node_modules/@xenova/transformers/node_modules/sharp`
- **Impact**: Clean startup with no GNotificationCenterDelegate namespace warnings; verified single libvips dylib loaded
- **Build files affected**: package.json

#### ONNX Runtime Logging Suppression
- **Issue**: ONNX runtime logging at WARNING level showing verbose graph optimization messages from CleanUnusedInitializersAndNodeArgs
- **Solution**:
  - Set `ORT_LOG_LEVEL=0` (FATAL level only, suppresses WARNING/INFO)
  - Added grep filter to remove remaining "CleanUnusedInitializersAndNodeArgs" debug lines
  - Applied to all start scripts: start, start:dev, start:prod, dev
- **Impact**: Clean startup logs, no unnecessary ONNX debug output
- **Build files affected**: package.json

### Changed

#### API Documentation Updates
- Added explicit documentation on "Response Data Consistency" for moment/date endpoints
- Clarified privacy enforcement: non-requester users receive public data only via explicit field selection (not filtering)
- Enhanced "Privacy & Security Notes" section with details on response-layer hardening and field construction
- Documented the guarantee that `user_a` and `user_b` objects have consistent "fat" structure across all endpoints

#### Response Mapping Standardization
- All moment-returning endpoints now use centralized `mapMomentForResponse()` function
- Ensures uniform user object structure: `{_id, first_name, avatar_url, image_url}`
- Applies same privacy rules across endpoints (GET, PATCH, POST)

### Technical Details

#### Code Changes
- **src/resources/moment/controller.ts**:
  - `updateMoment()` (line ~365): Added `.populate('user_b')` and `mapMomentForResponse()` call
  - `createMoment()` (line ~517): Added `.populate('user_b')` and `mapMomentForResponse()` call
  - `storeMoment()`: No changes (internal function, returns raw document for controller processing)

- **src/utils/user/moment.ts**:
  - `mapMomentForResponse()`: Centralized response formatter, used by all moment endpoints
  - Explicitly constructs user_a and user_b objects with 4 public fields only
  - Privacy is built into response construction, not post-hoc filtering

- **package.json**:
  - `pnpm.overrides`: Added `"sharp": "0.34.4"` to deduplicate versions
  - `postinstall`: Added cleanup script for nested sharp installations
  - `start`, `start:dev`, `start:prod`, `dev` scripts: Added `ORT_LOG_LEVEL=0` environment variable and grep filter

### Security

#### Privacy Enforcement Mechanism
- **Implicit model**: User objects in responses contain ONLY public fields (`_id`, `first_name`, avatar/image URLs)
- **Explicit construction**: Response mapper creates new objects with selected fields, not filtering full documents
- **Tested**: All non-requester users in responses expose public data only
- **Private fields blocked**: email, phone, location, preferences, core_answers, date_of_birth, etc.

### Performance

#### Build & Startup Improvements
- Sharp library deduplication reduces node_modules size and loader overhead
- ONNX runtime warning suppression reduces startup noise and improves initial logging clarity
- No functional performance impact; improvements are in build/startup UX

---

## Release Process

When preparing a release:
1. Update version in `package.json`
2. Add release date to top of CHANGELOG.md section
3. Move [Unreleased] changes to [X.X.X] section with date
4. Create git tag: `git tag -a vX.X.X -m "Release version X.X.X"`
5. Push tag: `git push origin vX.X.X`

---

## Notes for Developers

### Response Structure Guarantee

All endpoints returning moment data (`/api/moment`, `/api/user/meet`) guarantee:
```json
{
  "data": {
    "user_a": {
      "_id": "string (ObjectId)",
      "first_name": "string",
      "avatar_url": "string (S3 presigned URL)",
      "image_url": "string (S3 presigned URL)"
    },
    "user_b": {
      "_id": "string (ObjectId)",
      "first_name": "string",
      "avatar_url": "string (S3 presigned URL)",
      "image_url": "string (S3 presigned URL)"
    }
    // ... other moment fields
  }
}
```

This structure is guaranteed even after moments are updated. Frontend code can safely assume `user_a` and `user_b` are always fat objects.

### Privacy by Design

User objects are NOT filtered before sending to clients. Instead, only the necessary public fields are selected when constructing the response object. This prevents accidental leaks if new private fields are added to the User schema.

### Dependency Compatibility

- **sharp**: 0.34.4 (pinned via pnpm overrides due to @xenova/transformers bundling old version)
- **@xenova/transformers**: v2.17.2 (uses local sharp v0.34.4 via pnpm override)
- All other dependencies follow package.json specifications

---

For questions or to report issues, contact the development team.
